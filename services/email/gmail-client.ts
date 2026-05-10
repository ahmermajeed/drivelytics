import { getAccessToken } from "./auth";

/**
 * Thin wrapper around the Gmail API endpoints we actually use.
 *
 * Reference:
 *   https://developers.google.com/gmail/api/reference/rest/v1/users.messages/list
 *   https://developers.google.com/gmail/api/reference/rest/v1/users.messages/get
 *   https://developers.google.com/gmail/api/reference/rest/v1/users.messages/modify
 *
 * Gmail returns email bodies as base64url-encoded MIME parts; we walk the
 * tree to find the most usable text representation and decode it.
 */

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

interface GmailMessageRaw {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

export interface EmailMessage {
  id: string;
  subject: string;
  snippet: string;
  /** Decoded plaintext body (HTML stripped). */
  body: string;
  from: { name: string | null; address: string };
  receivedAt: string; // ISO string
  isUnread: boolean;
}

async function authorizedFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

async function jsonOrThrow<T>(r: Response, where: string): Promise<T> {
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Gmail ${where} failed (${r.status}): ${text.slice(0, 200)}`);
  }
  return (await r.json()) as T;
}

/**
 * Pull the most recent unread inbox messages. Two-step (Gmail's API forces
 * this): list returns ids only, then fetch each by id with `format=full`.
 */
export async function listUnreadMessages(limit = 10): Promise<EmailMessage[]> {
  const listUrl =
    `${GMAIL}/messages` +
    `?q=${encodeURIComponent("is:unread in:inbox -category:promotions -category:social")}` +
    `&maxResults=${Math.min(limit, 50)}`;

  const list = await jsonOrThrow<GmailListResponse>(
    await authorizedFetch(listUrl),
    "listMessages"
  );
  if (!list.messages || list.messages.length === 0) return [];

  // Fetch each message's full payload in parallel.
  const fulls = await Promise.all(
    list.messages.map(async (m) =>
      jsonOrThrow<GmailMessageRaw>(
        await authorizedFetch(`${GMAIL}/messages/${m.id}?format=full`),
        "getMessage"
      )
    )
  );

  return fulls.map(toEmailMessage);
}

/**
 * Strip the UNREAD label so the next poll won't pick this message up again.
 */
export async function markAsRead(messageId: string): Promise<void> {
  await jsonOrThrow(
    await authorizedFetch(`${GMAIL}/messages/${messageId}/modify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    }),
    "markAsRead"
  );
}

/**
 * Quick health/identity check. Returns null on auth failure rather than
 * throwing so the worker can keep going without dying.
 */
export async function whoAmI(): Promise<{ email: string | null } | null> {
  try {
    const r = await authorizedFetch(`${GMAIL}/profile`);
    if (!r.ok) return null;
    const json = (await r.json()) as { emailAddress?: string };
    return { email: json.emailAddress ?? null };
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// MIME / body decoding
// --------------------------------------------------------------------------

function findHeader(part: GmailPart | undefined, name: string): string | null {
  if (!part?.headers) return null;
  const lower = name.toLowerCase();
  const h = part.headers.find((x) => x.name.toLowerCase() === lower);
  return h?.value ?? null;
}

function decodeBase64Url(s: string): string {
  return Buffer.from(s, "base64url").toString("utf-8");
}

/**
 * Walk the MIME tree and return the best plaintext we can find.
 * Preference: text/plain → text/html (stripped) → snippet.
 */
function extractBody(payload: GmailPart | undefined): string {
  if (!payload) return "";

  // Prefer text/plain anywhere in the tree.
  const plain = findFirst(payload, (p) => p.mimeType === "text/plain");
  if (plain?.body?.data) {
    return decodeBase64Url(plain.body.data).trim();
  }

  // Fallback to text/html, stripped.
  const html = findFirst(payload, (p) => p.mimeType === "text/html");
  if (html?.body?.data) {
    return stripHtml(decodeBase64Url(html.body.data));
  }

  // No multipart at all — treat the root body as text.
  if (payload.body?.data) {
    const raw = decodeBase64Url(payload.body.data);
    return payload.mimeType === "text/html" ? stripHtml(raw) : raw.trim();
  }

  return "";
}

function findFirst(
  part: GmailPart,
  pred: (p: GmailPart) => boolean
): GmailPart | null {
  if (pred(part)) return part;
  for (const child of part.parts ?? []) {
    const hit = findFirst(child, pred);
    if (hit) return hit;
  }
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|br|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function parseFromHeader(value: string | null): { name: string | null; address: string } {
  if (!value) return { name: null, address: "" };
  // "Display Name" <user@example.com>  OR  user@example.com
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(value);
  if (m) {
    return { name: m[1]?.trim() || null, address: m[2].trim() };
  }
  return { name: null, address: value.trim() };
}

function toEmailMessage(raw: GmailMessageRaw): EmailMessage {
  const subject = findHeader(raw.payload, "Subject") ?? "(no subject)";
  const from = parseFromHeader(findHeader(raw.payload, "From"));
  const internal = raw.internalDate ? new Date(Number(raw.internalDate)) : new Date();
  const body = extractBody(raw.payload) || raw.snippet || "";
  const isUnread = (raw.labelIds ?? []).includes("UNREAD");

  return {
    id: raw.id,
    subject,
    snippet: raw.snippet ?? "",
    body,
    from,
    receivedAt: internal.toISOString(),
    isUnread,
  };
}
