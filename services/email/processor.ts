import { runAgent } from "../../lib/ai/agent";
import { emailTriageSystemPrompt } from "../../lib/ai/prompts";
import type { WhatsAppClient } from "../whatsapp/baileys";
import { type GraphMessage, markAsRead, plainTextOf } from "./graph-client";

/**
 * Process one incoming email through the AI triage agent and dispatch a
 * WhatsApp summary to the operator if it's a rental inquiry.
 *
 * The email is **always** marked as read on Microsoft Graph after we make
 * a decision, so the polling loop won't re-process it. If we crash before
 * marking, we'd re-process — but the AI's `SKIP` response is cheap and the
 * dispatch is keyed on Microsoft's stable message id, so duplicate dispatch
 * is the worst case (fine for an MVP).
 */

export interface ProcessOptions {
  whatsapp: WhatsAppClient;
  /** WhatsApp jid (or bare phone) to deliver inquiry alerts to. */
  notifyTo: string;
}

const MAX_BODY_CHARS = 6000; // keeps prompt size reasonable + costs predictable

export async function processEmail(
  msg: GraphMessage,
  opts: ProcessOptions
): Promise<{ skipped: boolean; reply?: string }> {
  const sender =
    msg.from?.emailAddress.name ||
    msg.from?.emailAddress.address ||
    "(unknown sender)";
  const senderEmail = msg.from?.emailAddress.address ?? "";

  const subject = msg.subject ?? "(no subject)";
  const bodyFull = plainTextOf(msg);
  const body =
    bodyFull.length > MAX_BODY_CHARS
      ? bodyFull.slice(0, MAX_BODY_CHARS) + "\n…(truncated)"
      : bodyFull;
  const received = msg.receivedDateTime;

  const userMessage =
    `An email just arrived. Decide whether it's a rental inquiry, then act per your instructions.\n\n` +
    `From: ${sender}${senderEmail ? ` <${senderEmail}>` : ""}\n` +
    `Subject: ${subject}\n` +
    `Received: ${received}\n\n` +
    `--- BODY ---\n${body}\n--- END BODY ---`;

  let reply: string;
  try {
    const out = await runAgent({
      userMessage,
      history: [],
      systemOverride: emailTriageSystemPrompt(),
    });
    reply = out.reply.trim();
  } catch (e) {
    // Don't let one bad email take the poller down. Mark as read and move on.
    console.error(`[email] AI failed for "${subject}":`, e);
    await markAsRead(msg.id).catch((err) =>
      console.error("[email] markAsRead failed:", err)
    );
    return { skipped: true };
  }

  // The triage prompt promises exactly "SKIP" for non-inquiries.
  if (/^SKIP\.?$/i.test(reply)) {
    await markAsRead(msg.id).catch((err) =>
      console.error("[email] markAsRead failed:", err)
    );
    return { skipped: true };
  }

  try {
    const jid = opts.notifyTo.includes("@")
      ? opts.notifyTo
      : `${opts.notifyTo.replace(/\D/g, "")}@s.whatsapp.net`;
    await opts.whatsapp.sendText(jid, reply);
  } catch (e) {
    console.error("[email] WhatsApp send failed:", e);
    // Don't mark as read if we couldn't notify — try again next poll.
    return { skipped: false, reply };
  }

  await markAsRead(msg.id).catch((err) =>
    console.error("[email] markAsRead failed:", err)
  );
  return { skipped: false, reply };
}
