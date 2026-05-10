import { runAgent } from "../../lib/ai/agent";
import { emailTriageSystemPrompt } from "../../lib/ai/prompts";
import type { WhatsAppClient } from "../whatsapp/baileys";
import { type EmailMessage, markAsRead } from "./gmail-client";

/**
 * Process one incoming email through the AI triage agent and dispatch a
 * WhatsApp summary to the operator if it's a rental inquiry.
 *
 * The email is **always** marked as read after we make a decision, so the
 * polling loop won't re-process it. If we crash before marking, we'd
 * re-process — but the AI's `SKIP` response is cheap and dispatch is keyed
 * on the message id, so duplicate dispatch is the worst case.
 */

export interface ProcessOptions {
  whatsapp: WhatsAppClient;
  /** WhatsApp jid (or bare phone) to deliver inquiry alerts to. */
  notifyTo: string;
}

const MAX_BODY_CHARS = 6000; // keeps prompt size reasonable + costs predictable

export async function processEmail(
  msg: EmailMessage,
  opts: ProcessOptions
): Promise<{ skipped: boolean; reply?: string }> {
  const sender = msg.from.name || msg.from.address || "(unknown sender)";
  const senderEmail = msg.from.address;

  const subject = msg.subject;
  const body =
    msg.body.length > MAX_BODY_CHARS
      ? msg.body.slice(0, MAX_BODY_CHARS) + "\n…(truncated)"
      : msg.body;

  const userMessage =
    `An email just arrived. Decide whether it's a rental inquiry, then act per your instructions.\n\n` +
    `From: ${sender}${senderEmail ? ` <${senderEmail}>` : ""}\n` +
    `Subject: ${subject}\n` +
    `Received: ${msg.receivedAt}\n\n` +
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

  // Defensive: if the model produced no usable content (empty string or
  // our agent's "(no reply)" placeholder), don't ship that to WhatsApp.
  // Mark the email read so we don't loop on it, but don't pester the
  // operator with a meaningless ping. This protects against rare model
  // glitches and emails with empty bodies (subject-only emails, etc.).
  if (!reply || reply === "(no reply)") {
    console.warn(
      `[email] model returned empty reply for "${subject.slice(0, 60)}" — skipping send`
    );
    await markAsRead(msg.id).catch((err) =>
      console.error("[email] markAsRead failed:", err)
    );
    return { skipped: true };
  }

  const jid = opts.notifyTo.includes("@")
    ? opts.notifyTo
    : `${opts.notifyTo.replace(/\D/g, "")}@s.whatsapp.net`;
  try {
    console.log(`[email] sending alert to ${jid} (${reply.length} chars)`);
    await opts.whatsapp.sendText(jid, reply);
  } catch (e) {
    console.error(`[email] WhatsApp send to ${jid} failed:`, e);
    // Don't mark as read if we couldn't notify — try again next poll.
    return { skipped: false, reply };
  }

  await markAsRead(msg.id).catch((err) =>
    console.error("[email] markAsRead failed:", err)
  );
  return { skipped: false, reply };
}
