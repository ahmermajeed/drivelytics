import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { persistTokens } from "../auth";
import { prisma } from "../../../lib/prisma";

/**
 * One-shot Google OAuth flow using the loopback redirect pattern.
 *
 * Run with: `npm run gmail:login`
 *
 * Steps:
 *  1. Bind a tiny HTTP server to a free port on 127.0.0.1.
 *  2. Construct the auth URL with that loopback as the redirect_uri.
 *  3. Open the operator's browser. They sign in, approve, Google redirects
 *     back to the loopback with `?code=...`.
 *  4. Server captures the code, exchanges it for tokens, persists, exits.
 *
 * No need to restart the worker afterward — `getAccessToken()` re-reads
 * the row on every call and refreshes transparently.
 */

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "openid",
  "email",
  "profile",
].join(" ");

const AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
  token_type?: string;
}

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        reject(new Error("Could not allocate a free port"));
      }
    });
  });
}

function openBrowser(url: string): void {
  // Best-effort: launch the user's default browser. If it fails (no GUI,
  // remote shell, etc.) we still printed the URL for them to open manually.
  const platform = process.platform;
  let cmd: string;
  if (platform === "win32") {
    // `start ""` syntax — the empty title is required so the URL isn't
    // interpreted as the window title.
    cmd = `start "" "${url}"`;
  } else if (platform === "darwin") {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  exec(cmd, (err) => {
    if (err) {
      console.error("(Could not auto-open browser; please open the URL above manually.)");
    }
  });
}

async function main(): Promise<void> {
  const clientId = process.env.GMAIL_CLIENT_ID || "";
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    console.error(
      "GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET not set in .env."
    );
    console.error(
      "Create OAuth credentials at https://console.cloud.google.com/apis/credentials"
    );
    process.exit(1);
  }

  const port = await pickFreePort();
  const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
  const state = crypto.randomBytes(16).toString("hex");

  const authUrl = new URL(AUTH_BASE);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  // `offline` makes Google issue a refresh_token; `prompt=consent` ensures
  // we get a *new* refresh token even if the user previously consented.
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  console.log("");
  console.log("─".repeat(64));
  console.log("  Opening browser to authorize Gmail access.");
  console.log("  If your browser doesn't open, paste this URL manually:");
  console.log("");
  console.log(`    ${authUrl.toString()}`);
  console.log("─".repeat(64));
  console.log("");

  // Wait for the auth code to come back via the loopback.
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
        if (u.pathname !== "/oauth/callback") {
          res.writeHead(404).end("Not found");
          return;
        }
        const error = u.searchParams.get("error");
        if (error) {
          respondHtml(res, 400, "Authorization failed", `Google returned: ${error}`);
          server.close();
          reject(new Error(`Authorization error: ${error}`));
          return;
        }
        const gotState = u.searchParams.get("state");
        const gotCode = u.searchParams.get("code");
        if (gotState !== state) {
          respondHtml(res, 400, "State mismatch", "Possible CSRF — please rerun the login.");
          server.close();
          reject(new Error("State mismatch"));
          return;
        }
        if (!gotCode) {
          respondHtml(res, 400, "Missing code", "Google did not return an authorization code.");
          server.close();
          reject(new Error("No code"));
          return;
        }
        respondHtml(
          res,
          200,
          "Drivelytics connected ✓",
          "You can close this tab and return to the terminal."
        );
        server.close();
        resolve(gotCode);
      } catch (e) {
        reject(e);
      }
    });
    server.listen(port, "127.0.0.1", () => {
      openBrowser(authUrl.toString());
    });
    // Hard timeout: 5 minutes.
    setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for browser authorization"));
    }, 5 * 60_000).unref();
  });

  console.log("Got authorization code, exchanging for tokens...");

  const tokenResp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!tokenResp.ok) {
    const text = await tokenResp.text().catch(() => "");
    console.error(`Token exchange failed (${tokenResp.status}): ${text.slice(0, 300)}`);
    process.exit(2);
  }

  const tokens = (await tokenResp.json()) as TokenResponse;
  if (!tokens.refresh_token) {
    console.error(
      "Google did not return a refresh_token. This usually means the user previously authorized this client."
    );
    console.error(
      "Revoke the existing access at https://myaccount.google.com/permissions and try again."
    );
    process.exit(2);
  }

  // Diagnostic: surface granted scopes so a mismatch is obvious immediately.
  const grantedScopes = (tokens.scope || "")
    .split(/\s+/)
    .filter(Boolean);
  console.log("");
  console.log(`Granted scopes (${grantedScopes.length}):`);
  for (const s of grantedScopes) console.log(`  - ${s}`);
  console.log("");

  const needsGmailModify = "https://www.googleapis.com/auth/gmail.modify";
  if (!grantedScopes.includes(needsGmailModify)) {
    console.error("✗ Required Gmail scope is missing.");
    console.error("");
    console.error(`  Expected: ${needsGmailModify}`);
    console.error("");
    console.error("Likely causes:");
    console.error("  1. The OAuth consent screen in Google Cloud Console doesn't list");
    console.error("     `gmail.modify` under 'Data Access'. Add it there, save, then retry.");
    console.error("  2. The granular consent screen was shown and the Gmail checkbox was");
    console.error("     left unticked. Revoke this app at");
    console.error("     https://myaccount.google.com/permissions and re-run `gmail:login`,");
    console.error("     making sure to approve ALL requested permissions.");
    console.error("");
    console.error("Tokens were NOT saved.");
    process.exit(3);
  }

  await persistTokens(tokens);
  console.log("✓ Authorized. Refresh token saved to Postgres.");
  console.log("  The worker will pick it up on its next email-poll cycle (within 60s).");
}

function respondHtml(
  res: http.ServerResponse,
  status: number,
  title: string,
  body: string
): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>${title}</title>
<style>
body { font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 80px auto; color: #1f2937; }
h1 { color: ${status < 400 ? "#059669" : "#dc2626"}; }
p { line-height: 1.5; }
</style>
</head>
<body><h1>${title}</h1><p>${body}</p></body>
</html>`);
}

main()
  .catch((e) => {
    console.error("Login failed:", (e as Error).message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
