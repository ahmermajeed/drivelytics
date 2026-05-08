import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import pino from "pino";
import { setState } from "./state";
import { useDBAuthState } from "./db-auth-state";

/**
 * Baileys WhatsApp client.
 *
 * Phase-3 scope:
 *   - Auth state persisted to **Postgres** (via `db-auth-state.ts`) so the
 *     worker survives container restarts on hosts without persistent disk.
 *   - QR rendered both to the terminal and to the in-memory state singleton
 *     (so the dashboard control plane can serve it).
 *   - 1:1 messages only — group chats are silently ignored for now.
 *   - Auto-reconnect on transient disconnects; halt on `loggedOut`.
 *
 * Reconnect design:
 *   The exported `WhatsAppClient` holds a *mutable* reference to the live
 *   socket. When Baileys disconnects (e.g. the standard 515 right after
 *   pairing), we boot a fresh socket and swap it in — so callers like the
 *   cron briefing keep the same client object and their `sendText` calls
 *   transparently use whichever socket is current.
 *
 * `triggerLogout()` is a manual logout that wipes auth state and forces a
 * fresh boot. It's called from the dashboard control plane.
 *
 * NOTE: Baileys is an unofficial reverse-engineered library. Use it only
 * for personal/internal numbers — not customer-facing messaging where a
 * sudden ban would be costly. For that, migrate to the WhatsApp Business
 * Platform.
 */

// Baileys is extremely chatty and logs a lot of harmless internals at
// "error" level (peer sync messages, prekey cache misses, init-query
// timeouts, etc.). Pin to "fatal" so the worker's own logs stay readable.
// Override via WA_LOG_LEVEL env var ("debug" / "trace") for troubleshooting.
const baileysLogger = pino({
  level: (process.env.WA_LOG_LEVEL as pino.Level) ?? "fatal",
});

export interface IncomingMessage {
  jid: string;
  phone: string;
  text: string;
  messageId: string;
}

export interface ConnectArgs {
  onMessage: (msg: IncomingMessage) => Promise<void>;
}

export interface WhatsAppClient {
  sendText(jid: string, text: string): Promise<void>;
  /**
   * Wipe local auth state and force a fresh pair. The socket will close,
   * the auth dir is cleared, and `boot()` runs again — at which point a
   * new QR is emitted to both the terminal and the state singleton.
   */
  triggerLogout(): Promise<void>;
  end(): void;
}

export async function connectWhatsApp(
  args: ConnectArgs
): Promise<WhatsAppClient> {
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(
    `[whatsapp] using protocol v${version.join(".")}${
      isLatest ? "" : " (not latest)"
    }`
  );

  let currentSock: WASocket | null = null;
  let stopped = false;
  // True between the user clicking "Logout & re-pair" and the next boot.
  // Suppresses the normal "loggedOut → halt" behavior for that one cycle.
  let forceReconnectAfterLogout = false;
  // Held across the lifetime of this client so triggerLogout() can clear
  // the persisted creds via the same store the active socket is using.
  let currentAuth: Awaited<ReturnType<typeof useDBAuthState>> | null = null;

  // Boot or re-boot a socket. Reloads auth state from Postgres on every call
  // so a logout (which clears the rows) always boots clean.
  const boot = async (): Promise<void> => {
    if (stopped) return;

    const auth = await useDBAuthState();
    currentAuth = auth;
    const { state, saveCreds } = auth;

    const sock = makeWASocket({
      version,
      auth: state,
      logger: baileysLogger,
      browser: Browsers.appropriate("Drivelytics"),
    });

    currentSock = sock;
    setState({ connection: "connecting" });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // Push to dashboard control plane *and* render in terminal — either
        // surface is fine for scanning, whichever the operator prefers.
        setState({ connection: "qr_pending", latestQR: qr, jid: null });
        console.log(
          "\n[whatsapp] Scan this QR with WhatsApp on your phone",
          "\n           (Settings → Linked Devices → Link a Device)",
          "\n           Or open the dashboard's WhatsApp button for a clearer view.\n"
        );
        qrcode.generate(qr, { small: true });
      }

      if (connection === "connecting") {
        setState({ connection: "connecting" });
      }

      if (connection === "open") {
        const me = sock.user?.id ?? null;
        setState({ connection: "open", jid: me, latestQR: null });
        console.log(`[whatsapp] connected as ${me ?? "(unknown)"}`);
        console.log(
          "[whatsapp] ✓ READY — send a message from an allowlisted phone to test."
        );
      }

      if (connection === "close") {
        if (stopped) return;

        const errOutput = (
          lastDisconnect?.error as
            | { output?: { statusCode?: number } }
            | undefined
        )?.output;
        const code = errOutput?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        const restart = code === DisconnectReason.restartRequired; // 515

        setState({ connection: "disconnected", jid: null, latestQR: null });

        if (loggedOut && !forceReconnectAfterLogout) {
          console.log(
            "[whatsapp] LOGGED OUT — use the dashboard's 'Logout & re-pair'",
            "button (or `npm run whatsapp:logout`) to clear auth state in",
            "Postgres and pair again from scratch."
          );
          stopped = true;
          return;
        }

        // For a manual logout we want to keep going so the next boot can
        // generate a fresh QR.
        const wasManual = forceReconnectAfterLogout;
        forceReconnectAfterLogout = false;

        if (restart) {
          console.log(
            "[whatsapp] restart required (post-pair sync). reconnecting..."
          );
        } else if (wasManual) {
          console.log("[whatsapp] manual logout. re-pairing...");
        } else {
          console.log(
            `[whatsapp] disconnected${
              code !== undefined ? ` (code ${code})` : ""
            } — reconnecting...`
          );
        }

        setTimeout(() => {
          boot().catch((e) =>
            console.error("[whatsapp] reconnect failed:", e)
          );
        }, restart || wasManual ? 250 : 2000);
      }
    });

    sock.ev.on("messages.upsert", async (m) => {
      const verbose = process.env.WA_VERBOSE !== "0";

      if (verbose) {
        console.log(
          `[trace] messages.upsert type=${m.type} count=${m.messages.length}`
        );
      }

      if (m.type !== "notify") return;

      for (const msg of m.messages) {
        const jid = msg.key.remoteJid ?? "(no-jid)";
        const fromMe = !!msg.key.fromMe;
        const isGroup = jid.endsWith("@g.us");
        // Modern WhatsApp uses both @s.whatsapp.net (phone-number JID) and
        // @lid (Linked-ID, a privacy-preserving alias). Both are valid 1:1
        // chats from our perspective.
        const isDirect =
          jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
        const text = extractText(msg);
        const phone = jid.split("@")[0]?.split(":")[0] ?? "";

        if (verbose) {
          const tag = fromMe
            ? "fromMe"
            : isGroup
            ? "group"
            : !isDirect
            ? "non-direct"
            : !text
            ? "no-text"
            : "ok";
          console.log(
            `[trace]   msg jid=${jid} fromMe=${fromMe} kind=${tag}` +
              (text ? ` text="${text.slice(0, 60)}"` : "")
          );
        }

        if (fromMe) continue;
        if (!isDirect) continue;
        if (!text) continue;

        try {
          await args.onMessage({
            jid,
            phone,
            text,
            messageId: msg.key.id ?? "",
          });
        } catch (e) {
          console.error("[whatsapp] message handler failed:", e);
        }
      }
    });
  };

  await boot();

  return {
    async sendText(jid, text) {
      if (!currentSock) {
        throw new Error("WhatsApp not connected yet");
      }
      await currentSock.sendMessage(jid, { text });
    },

    async triggerLogout() {
      console.log("[whatsapp] manual logout requested...");
      forceReconnectAfterLogout = true;

      // Best-effort: tell WhatsApp servers we're unlinking, so the device
      // disappears from the user's phone immediately.
      try {
        await currentSock?.logout("user requested logout");
      } catch {
        // Ignore — the close handler still runs and we wipe auth below.
      }

      // Hard wipe persisted creds so the next boot generates a fresh QR.
      try {
        await currentAuth?.clearAll();
      } catch (e) {
        console.error("[whatsapp] failed to clear DB auth state:", e);
      }

      setState({ connection: "disconnected", jid: null, latestQR: null });
    },

    end() {
      stopped = true;
      try {
        currentSock?.end(undefined);
      } catch {
        /* ignore */
      }
    },
  };
}

function extractText(msg: WAMessage): string | null {
  const m = msg.message;
  if (!m) return null;
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    null
  );
}
