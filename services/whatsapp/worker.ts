import { runAgent } from "../../lib/ai/agent";
import { AIConfigError, getProvider } from "../../lib/ai/providers";
import { allowlistInfo, isAllowed, jidToPhone } from "./allowlist";
import { connectWhatsApp } from "./baileys";
import { scheduleBriefings } from "./briefing";
import { clear, getHistory, setHistory } from "./conversation-store";
import { startControlServer } from "./control-server";

/**
 * Drivelytics WhatsApp worker — entrypoint.
 *
 * Run with: `npm run whatsapp`
 *
 * On first launch, scan the QR shown in the terminal with WhatsApp on your
 * phone (Settings → Linked Devices → Link a Device). Auth state is cached
 * to `services/whatsapp/auth-state/` so subsequent launches reconnect
 * silently.
 *
 * Required env vars:
 *   AI_PROVIDER, OPENAI_API_KEY (or ANTHROPIC_*) — same as the dashboard.
 *   AI_ALLOWED_PHONES — comma-separated list of allowed phone numbers.
 *
 * Optional:
 *   AI_BRIEFING_PHONE / AI_BRIEFING_CRON / AI_BRIEFING_TIMEZONE.
 */

async function main(): Promise<void> {
  banner();

  // Fail fast if AI isn't configured — better than discovering it on the
  // first message arrival, three hours into a Baileys session.
  try {
    const p = getProvider();
    console.log(`[ai] provider=${p.name} model=${p.model}`);
  } catch (e) {
    if (e instanceof AIConfigError) {
      console.error(`[fatal] ${e.message}`);
    } else {
      console.error("[fatal] AI provider failed to initialize:", e);
    }
    process.exit(1);
  }

  const info = allowlistInfo();
  if (info.count === 0) {
    console.error(
      "[fatal] AI_ALLOWED_PHONES is empty. Set it in .env to a comma-separated"
    );
    console.error(
      "        list of phone numbers (e.g. 923001234567,923009876543)."
    );
    process.exit(1);
  }
  console.log(
    `[allowlist] ${info.count} allowed phone(s): ${info.list.join(", ")}`
  );

  const client = await connectWhatsApp({
    onMessage: async ({ jid, text }) => {
      const phone = jidToPhone(jid);

      if (!isAllowed(jid)) {
        // Print the bare identifier prominently so the operator can copy it
        // into AI_ALLOWED_PHONES if they want to allow this sender. WhatsApp
        // uses opaque LIDs (e.g. "258475510726682@lid") for privacy now —
        // the digits before "@" are NOT a phone number, but they ARE stable
        // per-sender so the allowlist still works against them.
        console.log(
          `[ignored] sender=${phone} (${jid}) text="${preview(text)}"`
        );
        console.log(
          `          → to allow this sender, add "${phone}" to AI_ALLOWED_PHONES`
        );
        return;
      }

      console.log(`[recv] ${phone}: ${preview(text)}`);

      // Slash commands handled before invoking the model.
      const handled = await handleSlashCommand(text, jid, phone, client);
      if (handled) return;

      const history = getHistory(phone);
      try {
        const out = await runAgent({ userMessage: text, history });
        setHistory(phone, out.messages);
        await client.sendText(jid, out.reply);
        console.log(
          `[sent ] ${phone}: ${preview(out.reply)} ` +
            `(steps=${out.trace.steps}, tools=${out.trace.toolCalls.length})`
        );
      } catch (e) {
        // Don't leak full stack traces to WhatsApp. Map known failure modes
        // to readable user-facing messages; full detail still hits the log.
        console.error(`[error] ${phone}:`, e);
        const userMsg = friendlyAgentError(e);
        await client
          .sendText(jid, userMsg)
          .catch(() => undefined);
      }
    },
  });

  scheduleBriefings(client);

  const controlPort = Number(process.env.WA_CONTROL_PORT ?? 3001);
  const server = startControlServer({ client, port: controlPort });

  // Graceful shutdown
  const shutdown = (sig: string) => {
    console.log(`\n[shutdown] received ${sig}, closing socket...`);
    server.close();
    client.end();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

async function handleSlashCommand(
  text: string,
  jid: string,
  phone: string,
  client: { sendText: (j: string, t: string) => Promise<void> }
): Promise<boolean> {
  const trimmed = text.trim().toLowerCase();

  if (trimmed === "/clear" || trimmed === "/reset") {
    clear(phone);
    await client.sendText(jid, "Conversation cleared. ✨");
    return true;
  }

  if (trimmed === "/help") {
    await client.sendText(
      jid,
      [
        "*Drivelytics AI*",
        "Just type your question naturally — e.g.",
        "  • _Which rentals are expiring this week?_",
        "  • _Find the Civic_",
        "  • _Ahmed paid 5000, record it._",
        "",
        "*Commands*",
        "/help — this message",
        "/clear — wipe my memory of this chat",
        "/status — show worker info",
      ].join("\n")
    );
    return true;
  }

  if (trimmed === "/status") {
    const p = getProvider();
    await client.sendText(
      jid,
      [
        "*Drivelytics worker*",
        `Provider: ${p.name}`,
        `Model: ${p.model}`,
        `Uptime: ${formatUptime(process.uptime())}`,
      ].join("\n")
    );
    return true;
  }

  return false;
}

function preview(s: string): string {
  return s.length > 80 ? s.slice(0, 77) + "..." : s;
}

/**
 * Translate raw provider/SDK errors into something a WhatsApp user can
 * actually act on. Anything we don't recognize falls back to a generic
 * "I had a hiccup" — the full error is in the worker's stderr for debugging.
 */
function friendlyAgentError(e: unknown): string {
  const msg = (e as Error)?.message ?? "";
  const code = (e as { code?: string })?.code ?? "";
  const status = (e as { status?: number })?.status;

  if (code === "tool_use_failed" || /tool_use_failed/.test(msg)) {
    return (
      "Sorry — the AI returned a malformed tool call. " +
      "Try rephrasing, or switch to a more reliable model in .env " +
      "(e.g. OPENAI_MODEL=\"openai/gpt-oss-20b\")."
    );
  }
  if (status === 429 || /rate.?limit|quota/i.test(msg)) {
    return "I'm being rate-limited by the AI provider. Try again in a minute.";
  }
  if (status === 401 || status === 403) {
    return "AI provider rejected the API key. Check OPENAI_API_KEY in .env.";
  }
  if (/ECONNREFUSED|ENOTFOUND|fetch failed/i.test(msg)) {
    return "Couldn't reach the AI provider. Check your internet / endpoint URL.";
  }
  if (/AIConfigError/i.test(msg)) {
    return "AI is not configured. Set OPENAI_API_KEY (or ANTHROPIC_API_KEY) in .env and restart.";
  }
  // Last-resort: show a short hint, never a stack trace.
  const first = msg.split("\n")[0]?.slice(0, 200) || "unknown error";
  return `Sorry — I hit an error: ${first}`;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function banner(): void {
  const line = "═".repeat(56);
  console.log(line);
  console.log("  Drivelytics WhatsApp worker");
  console.log("  Press Ctrl+C to stop");
  console.log(line);
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
