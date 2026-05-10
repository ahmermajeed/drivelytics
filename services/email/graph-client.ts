import { getAccessToken } from "./auth";

/**
 * Thin wrapper around Microsoft Graph endpoints we actually use.
 *
 * The Graph SDK is fine but pulls in a lot of indirect deps for what we
 * need (just three endpoints). Raw fetch with a typed surface is simpler.
 *
 * Reference:
 *   https://learn.microsoft.com/en-us/graph/api/user-list-messages
 *   https://learn.microsoft.com/en-us/graph/api/message-update
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

export interface GraphMessage {
  id: string;
  subject: string | null;
  bodyPreview: string | null;
  /** HTML or text. We strip HTML in the processor. */
  body: { contentType: "html" | "text"; content: string } | null;
  from: {
    emailAddress: { name: string | null; address: string };
  } | null;
  receivedDateTime: string;
  isRead: boolean;
}

interface ListResponse {
  "@odata.nextLink"?: string;
  value: GraphMessage[];
}

async function authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

/**
 * Pull the most recent unread emails. We fetch a small page (default 10)
 * to avoid spending tokens on a huge backlog right after connecting; older
 * already-read emails will simply never be processed.
 */
export async function listUnreadMessages(
  limit = 10
): Promise<GraphMessage[]> {
  const url =
    `${GRAPH}/me/mailFolders/inbox/messages` +
    `?$filter=${encodeURIComponent("isRead eq false")}` +
    `&$orderby=${encodeURIComponent("receivedDateTime desc")}` +
    `&$top=${Math.min(limit, 50)}` +
    `&$select=${encodeURIComponent(
      "id,subject,bodyPreview,body,from,receivedDateTime,isRead"
    )}`;

  const r = await authorizedFetch(url);
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(
      `Graph listUnreadMessages failed (${r.status}): ${text.slice(0, 200)}`
    );
  }
  const json = (await r.json()) as ListResponse;
  return json.value;
}

export async function markAsRead(messageId: string): Promise<void> {
  const r = await authorizedFetch(
    `${GRAPH}/me/messages/${messageId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRead: true }),
    }
  );
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(
      `Graph markAsRead failed (${r.status}): ${text.slice(0, 200)}`
    );
  }
}

/**
 * Quick health/identity check. Returns null on auth failure rather than
 * throwing so the worker can keep going without dying.
 */
export async function whoAmI(): Promise<{ email: string | null } | null> {
  try {
    const r = await authorizedFetch(`${GRAPH}/me?$select=mail,userPrincipalName`);
    if (!r.ok) return null;
    const json = (await r.json()) as {
      mail?: string;
      userPrincipalName?: string;
    };
    return { email: json.mail ?? json.userPrincipalName ?? null };
  } catch {
    return null;
  }
}

/**
 * Strip HTML tags and collapse whitespace from an email body. Keeps the
 * AI prompt small and cheap. Doesn't try to be a perfect sanitizer — the
 * agent never executes the content, just reads it.
 */
export function plainTextOf(msg: GraphMessage): string {
  if (!msg.body) return msg.bodyPreview ?? "";
  if (msg.body.contentType === "text") return msg.body.content.trim();
  // HTML → text
  return msg.body.content
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
