/**
 * Phone allowlist for incoming WhatsApp messages.
 *
 * The list is sourced from `AI_ALLOWED_PHONES`, a comma-separated string of
 * phone numbers in any format (with or without "+", spaces, dashes — we
 * normalize to digits only). Anything not on the list is silently dropped.
 *
 * Fail-closed: if the env var is empty, NO sender is allowed. The worker
 * refuses to start in that case so this branch is rare.
 */

let cached: Set<string> | null = null;

function digits(s: string): string {
  return String(s).replace(/\D/g, "");
}

function load(): Set<string> {
  if (cached) return cached;
  const raw = process.env.AI_ALLOWED_PHONES || "";
  cached = new Set(
    raw
      .split(",")
      .map((s) => digits(s))
      .filter(Boolean)
  );
  return cached;
}

/**
 * Pull the bare phone number out of a WhatsApp jid.
 *
 *   "923001234567@s.whatsapp.net"        -> "923001234567"
 *   "923001234567:42@s.whatsapp.net"     -> "923001234567"   (multi-device suffix)
 */
export function jidToPhone(jid: string): string {
  return jid.split("@")[0]?.split(":")[0] ?? "";
}

export function isAllowed(jid: string): boolean {
  const list = load();
  if (list.size === 0) return false;
  return list.has(digits(jidToPhone(jid)));
}

export function allowlistInfo(): { count: number; list: string[] } {
  const list = load();
  return { count: list.size, list: Array.from(list) };
}
