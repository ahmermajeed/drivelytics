import { prisma } from "../../lib/prisma";

/**
 * Gmail OAuth token storage + refresh.
 *
 * We persist a single row in `EmailAuth` (id="default", provider="gmail").
 * The access token is short-lived (~1h) and the refresh token is long-lived.
 * On every `getAccessToken()` call we transparently refresh if the access
 * token is within 60 seconds of expiry.
 *
 * Google's OAuth flow uses an installed "Desktop app" credential. Both the
 * client_id and client_secret are required for the token-exchange and
 * refresh calls (Google's "secret" is not actually a secret in the OAuth
 * sense — it's a public identifier for desktop apps — but the API still
 * requires it).
 */

const PROVIDER = "gmail";
const ROW_ID = "default";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** 60s safety window — refresh before the token actually expires. */
const REFRESH_SKEW_MS = 60_000;

interface TokenResponse {
  access_token: string;
  refresh_token?: string; // omitted on most refresh responses
  expires_in: number;
  scope?: string;
  id_token?: string;
  token_type?: string;
}

interface StoredAuth {
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  email: string | null;
}

export class EmailNotConnectedError extends Error {
  constructor() {
    super(
      "Email (Gmail) is not connected. Run `npm run gmail:login` to authorize."
    );
    this.name = "EmailNotConnectedError";
  }
}

export class EmailConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "EmailConfigError";
  }
}

function ensureClient(): { id: string; secret: string } {
  const id = process.env.GMAIL_CLIENT_ID || "";
  const secret = process.env.GMAIL_CLIENT_SECRET || "";
  if (!id) {
    throw new EmailConfigError(
      "GMAIL_CLIENT_ID is not set. Create OAuth credentials in Google Cloud Console and put them in .env."
    );
  }
  if (!secret) {
    throw new EmailConfigError(
      "GMAIL_CLIENT_SECRET is not set. Pair it with GMAIL_CLIENT_ID from your Google Cloud OAuth client."
    );
  }
  return { id, secret };
}

async function loadStored(): Promise<StoredAuth | null> {
  const row = await prisma.emailAuth.findUnique({ where: { id: ROW_ID } });
  if (!row) return null;
  if (row.provider !== PROVIDER) return null;
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
    const claims = JSON.parse(payload) as { email?: string };
    return claims.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Persist a fresh token response. Google does NOT typically issue a new
 * refresh token on refresh — we hold onto the original one in that case.
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
  await prisma.emailAuth.upsert({
    where: { id: ROW_ID },
    update: {
      provider: PROVIDER,
      refreshToken: refresh,
      accessToken: resp.access_token,
      accessTokenExpiresAt: expiresAt,
      email: email ?? undefined,
    },
    create: {
      id: ROW_ID,
      provider: PROVIDER,
      refreshToken: refresh,
      accessToken: resp.access_token,
      accessTokenExpiresAt: expiresAt,
      email,
    },
  });
}

/**
 * Returns a usable access token, refreshing transparently if needed.
 * Throws `EmailNotConnectedError` if no tokens have been stored yet.
 */
export async function getAccessToken(): Promise<string> {
  const { id, secret } = ensureClient();
  const stored = await loadStored();
  if (!stored) throw new EmailNotConnectedError();

  if (
    stored.accessTokenExpiresAt.getTime() - Date.now() >
    REFRESH_SKEW_MS
  ) {
    return stored.accessToken;
  }

  const params = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    grant_type: "refresh_token",
    refresh_token: stored.refreshToken,
  });

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(
      `Gmail token refresh failed (${r.status}): ${text.slice(0, 200)}`
    );
  }

  const json = (await r.json()) as TokenResponse;
  await persistTokens(json, stored.refreshToken);
  return json.access_token;
}

export async function getConnectedAccount(): Promise<{ email: string | null } | null> {
  const stored = await loadStored();
  if (!stored) return null;
  return { email: stored.email };
}

export async function clearTokens(): Promise<void> {
  await prisma.emailAuth
    .delete({ where: { id: ROW_ID } })
    .catch(() => undefined);
}
