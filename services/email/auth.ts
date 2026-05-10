import { prisma } from "../../lib/prisma";

/**
 * Microsoft Graph OAuth token storage + refresh.
 *
 * We persist a single row in `OutlookAuth` (id="default"). The access token
 * is short-lived (~1 hour) and the refresh token is long-lived. On every
 * `getAccessToken()` call we transparently refresh if the access token is
 * within 60 seconds of expiry.
 *
 * For *personal* Microsoft accounts (outlook.com / hotmail.com / live.com)
 * the OAuth tenant must be `consumers`. For work / Microsoft 365 use
 * `organizations`. `common` works for both but issues tokens that may not
 * have refresh-token capability for personal accounts in some flows.
 */

const TENANT = process.env.OUTLOOK_TENANT || "consumers";
const CLIENT_ID = process.env.OUTLOOK_CLIENT_ID || "";
const ROW_ID = "default";

const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;

/** 60s safety window — refresh before the token actually expires. */
const REFRESH_SKEW_MS = 60_000;

interface TokenResponse {
  access_token: string;
  refresh_token?: string; // sometimes omitted on refresh
  expires_in: number;
  scope?: string;
  id_token?: string;
}

interface StoredAuth {
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  email: string | null;
}

export class OutlookNotConnectedError extends Error {
  constructor() {
    super(
      "Outlook is not connected. Run `npm run outlook:login` to authorize."
    );
    this.name = "OutlookNotConnectedError";
  }
}

export class OutlookConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "OutlookConfigError";
  }
}

function ensureClientId(): string {
  if (!CLIENT_ID) {
    throw new OutlookConfigError(
      "OUTLOOK_CLIENT_ID is not set. Register an Azure AD app and put the Application (client) ID in .env."
    );
  }
  return CLIENT_ID;
}

async function loadStored(): Promise<StoredAuth | null> {
  const row = await prisma.outlookAuth.findUnique({ where: { id: ROW_ID } });
  if (!row) return null;
  return {
    refreshToken: row.refreshToken,
    accessToken: row.accessToken,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    email: row.email,
  };
}

/** Decode the `email` claim out of an id_token JWT (no signature verification). */
function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const parts = idToken.split(".");
    if (parts.length < 2) return null;
    const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
    const claims = JSON.parse(payload) as {
      email?: string;
      preferred_username?: string;
    };
    return claims.email ?? claims.preferred_username ?? null;
  } catch {
    return null;
  }
}

/**
 * Persist a fresh token response. Microsoft sometimes returns a NEW refresh
 * token on refresh — we always overwrite to keep the latest one.
 */
export async function persistTokens(
  resp: TokenResponse,
  fallbackRefreshToken?: string
): Promise<void> {
  const refresh = resp.refresh_token ?? fallbackRefreshToken;
  if (!refresh) {
    throw new Error(
      "Token response had no refresh_token and no fallback was provided"
    );
  }
  const expiresAt = new Date(Date.now() + resp.expires_in * 1000);
  const email = emailFromIdToken(resp.id_token);
  await prisma.outlookAuth.upsert({
    where: { id: ROW_ID },
    update: {
      refreshToken: refresh,
      accessToken: resp.access_token,
      accessTokenExpiresAt: expiresAt,
      email: email ?? undefined,
    },
    create: {
      id: ROW_ID,
      refreshToken: refresh,
      accessToken: resp.access_token,
      accessTokenExpiresAt: expiresAt,
      email,
    },
  });
}

/**
 * Returns a usable access token, refreshing transparently if needed.
 * Throws `OutlookNotConnectedError` if no tokens have been stored yet.
 */
export async function getAccessToken(): Promise<string> {
  ensureClientId();
  const stored = await loadStored();
  if (!stored) throw new OutlookNotConnectedError();

  if (
    stored.accessTokenExpiresAt.getTime() - Date.now() >
    REFRESH_SKEW_MS
  ) {
    return stored.accessToken;
  }

  // Refresh.
  const params = new URLSearchParams({
    client_id: ensureClientId(),
    grant_type: "refresh_token",
    refresh_token: stored.refreshToken,
    scope: "Mail.Read Mail.ReadWrite offline_access User.Read",
  });

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(
      `Outlook token refresh failed (${r.status}): ${text.slice(0, 200)}`
    );
  }

  const json = (await r.json()) as TokenResponse;
  await persistTokens(json, stored.refreshToken);
  return json.access_token;
}

/** Account info for display ("connected as ...") */
export async function getConnectedAccount(): Promise<{
  email: string | null;
} | null> {
  const stored = await loadStored();
  if (!stored) return null;
  return { email: stored.email };
}

export async function clearTokens(): Promise<void> {
  await prisma.outlookAuth
    .delete({ where: { id: ROW_ID } })
    .catch(() => undefined);
}
