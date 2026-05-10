import { OutlookConfigError, OutlookNotConnectedError, getConnectedAccount } from "./auth";
import { listUnreadMessages, whoAmI } from "./graph-client";
import { processEmail } from "./processor";
import type { WhatsAppClient } from "../whatsapp/baileys";

/**
 * Outlook polling loop.
 *
 * Runs alongside the Baileys WhatsApp connection in the same worker process,
 * sharing the same AI provider, tools, and database. Pulls unread emails
 * every `OUTLOOK_POLL_INTERVAL_MS` (default 60s), runs each through the
 * triage agent, and dispatches a WhatsApp alert for rental inquiries.
 *
 * Idempotency: we mark each email as read on Microsoft Graph after the
 * decision, so the next poll won't pick it up again.
 *
 * Configuration:
 *   OUTLOOK_CLIENT_ID            Azure app client id (required)
 *   OUTLOOK_TENANT               "consumers" (default) | "organizations" | "common"
 *   OUTLOOK_POLL_INTERVAL_MS     ms between polls (default 60000)
 *   OUTLOOK_NOTIFY_PHONE         where to send alerts (falls back to AI_BRIEFING_PHONE)
 *   OUTLOOK_BATCH_SIZE           max emails per poll (default 10)
 */

const DEFAULT_INTERVAL_MS = 60_000;

export interface StartOptions {
  whatsapp: WhatsAppClient;
}

export function startEmailPoller(opts: StartOptions): NodeJS.Timeout | null {
  if (!process.env.OUTLOOK_CLIENT_ID) {
    console.log(
      "[email] OUTLOOK_CLIENT_ID not set — email integration disabled."
    );
    return null;
  }

  const notifyTo = (
    process.env.OUTLOOK_NOTIFY_PHONE ||
    process.env.AI_BRIEFING_PHONE ||
    ""
  ).trim();
  if (!notifyTo) {
    console.log(
      "[email] OUTLOOK_NOTIFY_PHONE / AI_BRIEFING_PHONE not set — email integration disabled."
    );
    return null;
  }

  const interval = Math.max(
    15_000, // floor: don't pound Microsoft
    Number(process.env.OUTLOOK_POLL_INTERVAL_MS ?? DEFAULT_INTERVAL_MS)
  );
  const batchSize = Math.min(
    50,
    Math.max(1, Number(process.env.OUTLOOK_BATCH_SIZE ?? 10))
  );

  console.log(
    `[email] poller starting — every ${interval / 1000}s, up to ${batchSize} emails per cycle, notifying ${notifyTo}`
  );

  // Best-effort intro line so the operator knows which account is wired up.
  void getConnectedAccount()
    .then(async (a) => {
      if (a?.email) {
        console.log(`[email] connected as ${a.email}`);
        return;
      }
      const live = await whoAmI();
      if (live?.email) console.log(`[email] connected as ${live.email}`);
    })
    .catch(() => undefined);

  // Don't fire the first poll instantly — give the worker a moment to settle
  // (esp. the Baileys handshake) so the first WhatsApp send is not racing.
  let running = false;
  const tick = async () => {
    if (running) return; // skip if previous tick still in flight
    running = true;
    try {
      const messages = await listUnreadMessages(batchSize);
      if (messages.length === 0) return;
      console.log(`[email] poll: ${messages.length} unread email(s) to triage`);
      for (const msg of messages) {
        const subject = (msg.subject ?? "(no subject)").slice(0, 60);
        try {
          const result = await processEmail(msg, {
            whatsapp: opts.whatsapp,
            notifyTo,
          });
          console.log(
            `[email]   "${subject}" → ${
              result.skipped ? "SKIP" : "alert sent"
            }`
          );
        } catch (e) {
          console.error(`[email]   "${subject}" failed:`, e);
        }
      }
    } catch (e) {
      if (e instanceof OutlookNotConnectedError) {
        console.error(
          "[email] not connected to Outlook. Run `npm run outlook:login` to authorize."
        );
      } else if (e instanceof OutlookConfigError) {
        console.error(`[email] config error: ${e.message}`);
      } else {
        console.error("[email] poll failed:", (e as Error).message);
      }
    } finally {
      running = false;
    }
  };

  // First tick after a small delay; subsequent ticks at the interval.
  const handle = setTimeout(() => {
    void tick();
    setInterval(() => void tick(), interval);
  }, 5_000);

  return handle;
}
