import cron from "node-cron";
import { runAgent } from "../../lib/ai/agent";
import { listEnriched } from "../../lib/cars";
import type { WhatsAppClient } from "./baileys";

/**
 * Proactive daily briefing.
 *
 * The cron job:
 *  1. Pre-checks the DB for anything notable (expiring within 2 days OR
 *     overdue). If there's nothing, we don't message — silence is the
 *     correct answer most days.
 *  2. Asks the agent (with EMPTY history — this is its own context) to
 *     compose a short briefing.
 *  3. Sends the result via WhatsApp to AI_BRIEFING_PHONE.
 *
 * Env vars:
 *   AI_BRIEFING_PHONE     digits-only phone (e.g. 923001234567)
 *   AI_BRIEFING_CRON      cron expression (default "0 9 * * *" = 9 AM daily)
 *   AI_BRIEFING_TIMEZONE  IANA tz (default "Asia/Karachi")
 */

const DEFAULT_CRON = "0 9 * * *";
const DEFAULT_TZ = "Asia/Karachi";

export function scheduleBriefings(client: WhatsAppClient): void {
  const target = (process.env.AI_BRIEFING_PHONE || "").trim();
  if (!target) {
    console.log(
      "[briefing] AI_BRIEFING_PHONE not set — proactive briefings disabled."
    );
    return;
  }

  const expr = process.env.AI_BRIEFING_CRON || DEFAULT_CRON;
  const tz = process.env.AI_BRIEFING_TIMEZONE || DEFAULT_TZ;

  if (!cron.validate(expr)) {
    console.error(
      `[briefing] AI_BRIEFING_CRON='${expr}' is invalid. Disabling.`
    );
    return;
  }

  console.log(
    `[briefing] scheduled "${expr}" (${tz}) -> ${target}`
  );

  cron.schedule(
    expr,
    () => {
      void runBriefing(client, target);
    },
    { timezone: tz }
  );
}

async function runBriefing(
  client: WhatsAppClient,
  phoneOrJid: string
): Promise<void> {
  try {
    const expiringSoon = await listEnriched({
      status: "expiring",
      expiringWithinDays: 2,
      limit: 50,
    });
    const overdue = await listEnriched({ status: "overdue", limit: 50 });

    if (expiringSoon.length === 0 && overdue.length === 0) {
      console.log("[briefing] nothing notable today; skipping send.");
      return;
    }

    const out = await runAgent({
      userMessage:
        "Compose this morning's operations briefing. List rentals expiring " +
        "today and tomorrow with car/renter/date, and any overdue rentals " +
        "with how many days late. Use bullets. Keep it under 12 lines. End " +
        "with a one-line action summary.",
      history: [],
    });

    const jid = phoneOrJid.includes("@")
      ? phoneOrJid
      : `${phoneOrJid.replace(/\D/g, "")}@s.whatsapp.net`;

    const body = `🔔 *Drivelytics Daily Briefing*\n\n${out.reply}`;
    await client.sendText(jid, body);
    console.log(`[briefing] sent to ${phoneOrJid}`);
  } catch (e) {
    console.error("[briefing] failed:", e);
  }
}
