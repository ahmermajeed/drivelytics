import { persistTokens } from "../auth";
import { prisma } from "../../../lib/prisma";

/**
 * One-shot device-code OAuth flow.
 *
 * Run with: `npm run outlook:login`
 *
 * Prints a short user code and a verification URL. The operator opens the
 * URL on any device, signs in to their Microsoft account, and pastes the
 * code. We poll the token endpoint until they finish; then store the
 * refresh + access tokens in Postgres so the worker can pick them up on
 * its next poll cycle.
 *
 * No need to restart the worker afterward — `getAccessToken()` re-reads
 * the row on every call and refreshes transparently.
 */

const TENANT = process.env.OUTLOOK_TENANT || "consumers";
const CLIENT_ID = process.env.OUTLOOK_CLIENT_ID || "";

const SCOPES = "Mail.Read Mail.ReadWrite offline_access User.Read";

interface DeviceCodeResponse {
  user_code: string;
  device_code: string;
  verification_uri: string;
  /** Sometimes "verification_uri_complete" with the code embedded. */
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
  message: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
}

interface OAuthError {
  error: string;
  error_description?: string;
}

async function main(): Promise<void> {
  if (!CLIENT_ID) {
    console.error(
      "OUTLOOK_CLIENT_ID is not set. Register an Azure AD app and put the Application (client) ID in .env first."
    );
    process.exit(1);
  }

  console.log("Requesting device code from Microsoft...");
  const codeResp = await fetch(
    `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/devicecode`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        scope: SCOPES,
      }).toString(),
    }
  );
  if (!codeResp.ok) {
    const text = await codeResp.text().catch(() => "");
    console.error(
      `Device code request failed (${codeResp.status}): ${text.slice(0, 300)}`
    );
    process.exit(1);
  }
  const code = (await codeResp.json()) as DeviceCodeResponse;

  console.log("");
  console.log("─".repeat(60));
  console.log("  Open this URL and enter the code:");
  console.log(`    URL:  ${code.verification_uri}`);
  console.log(`    Code: ${code.user_code}`);
  console.log("─".repeat(60));
  if (code.verification_uri_complete) {
    console.log(
      `  Or open this direct URL (no manual code entry needed):\n    ${code.verification_uri_complete}`
    );
    console.log("");
  }
  console.log(
    `  Polling for completion (expires in ${Math.round(code.expires_in / 60)} min)...`
  );

  // Poll for token.
  const intervalMs = (code.interval || 5) * 1000;
  const deadline = Date.now() + code.expires_in * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const tokenResp = await fetch(
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          client_id: CLIENT_ID,
          device_code: code.device_code,
        }).toString(),
      }
    );

    if (tokenResp.ok) {
      const json = (await tokenResp.json()) as TokenResponse;
      await persistTokens(json);
      console.log("");
      console.log("✓ Authorized. Refresh token saved to Postgres.");
      console.log(
        "  The worker will pick it up on its next email-poll cycle (within 60s)."
      );
      return;
    }

    // 4xx with a known error means we keep polling or fail outright.
    const err = (await tokenResp
      .json()
      .catch(() => ({ error: "unknown" }))) as OAuthError;
    if (err.error === "authorization_pending") {
      // Still waiting for the user — keep polling.
      continue;
    }
    if (err.error === "slow_down") {
      // Microsoft asks us to back off; lengthen the interval.
      await sleep(intervalMs);
      continue;
    }
    if (err.error === "authorization_declined") {
      console.error("  ✗ User declined the authorization.");
      process.exit(2);
    }
    if (err.error === "expired_token") {
      console.error("  ✗ Code expired. Re-run the command.");
      process.exit(2);
    }
    console.error(
      `  ✗ Authorization failed: ${err.error}${
        err.error_description ? ` — ${err.error_description}` : ""
      }`
    );
    process.exit(2);
  }

  console.error("  ✗ Timed out waiting for user to authorize.");
  process.exit(2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main()
  .catch((e) => {
    console.error("Login failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
