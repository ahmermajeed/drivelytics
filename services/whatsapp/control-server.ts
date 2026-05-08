import http from "node:http";
import { getState } from "./state";
import type { WhatsAppClient } from "./baileys";

/**
 * Tiny HTTP control plane the dashboard talks to.
 *
 * Endpoints:
 *   GET  /api/health   → liveness
 *   GET  /api/status   → current connection state (json)
 *   GET  /api/qr       → latest QR string when pairing, null when connected
 *   POST /api/logout   → trigger logout + fresh re-pair
 *
 * Bind address:
 *   - Locally:  127.0.0.1 (default; isolated from the LAN)
 *   - In cloud: 0.0.0.0   (set WA_CONTROL_HOST=0.0.0.0 so the host's
 *                          ingress can reach the worker)
 *
 * Auth:
 *   - When WA_CONTROL_TOKEN is set, every request must carry
 *     `Authorization: Bearer <token>`. Required as soon as the bind
 *     address is anything other than 127.0.0.1.
 *   - When unset (and bound to localhost), all requests are accepted —
 *     reasonable for purely-local dev.
 */

interface ServerArgs {
  client: WhatsAppClient;
  port: number;
  host?: string;
}

export function startControlServer({
  client,
  port,
  host = process.env.WA_CONTROL_HOST || "127.0.0.1",
}: ServerArgs): http.Server {
  const requiredToken = process.env.WA_CONTROL_TOKEN || "";

  // If we're exposing to the world but no token is set, bail loudly. This
  // is the kind of misconfiguration that's easy to make and very expensive
  // to discover in production.
  if (host !== "127.0.0.1" && !requiredToken) {
    console.error(
      "[control] FATAL: WA_CONTROL_HOST is exposed but WA_CONTROL_TOKEN is empty."
    );
    console.error(
      "          Set WA_CONTROL_TOKEN to a long random string before going public."
    );
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    const sendJson = (status: number, body: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(body));
    };

    const url = req.url ?? "";
    const method = req.method ?? "GET";

    // Bearer-token gate. Health endpoint is intentionally exempt so a
    // platform's healthchecker doesn't need the token.
    if (requiredToken && url !== "/api/health") {
      const auth = req.headers["authorization"] ?? "";
      const presented =
        typeof auth === "string" && auth.startsWith("Bearer ")
          ? auth.slice("Bearer ".length).trim()
          : "";
      if (presented !== requiredToken) {
        sendJson(401, { ok: false, error: "Unauthorized" });
        return;
      }
    }

    try {
      if (method === "GET" && url === "/api/status") {
        sendJson(200, { ok: true, data: getState() });
        return;
      }

      if (method === "GET" && url === "/api/qr") {
        sendJson(200, { ok: true, data: { qr: getState().latestQR } });
        return;
      }

      if (method === "POST" && url === "/api/logout") {
        // Don't await — logout takes a couple seconds and the UI just needs
        // confirmation that the action started.
        client
          .triggerLogout()
          .catch((e) => console.error("[control] logout failed:", e));
        sendJson(202, { ok: true });
        return;
      }

      if (method === "GET" && url === "/api/health") {
        sendJson(200, { ok: true, data: { worker: "running" } });
        return;
      }

      sendJson(404, { ok: false, error: "Not found" });
    } catch (e) {
      console.error("[control] handler crashed:", e);
      sendJson(500, { ok: false, error: (e as Error).message });
    }
  });

  server.listen(port, host, () => {
    const exposure = host === "127.0.0.1" ? "localhost-only" : `bound to ${host}`;
    console.log(
      `[control] HTTP control plane on http://${host}:${port} (${exposure})` +
        (requiredToken ? " — auth: Bearer token" : " — auth: none")
    );
  });

  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") {
      console.error(
        `[control] port ${port} is already in use — set WA_CONTROL_PORT in .env to a free port.`
      );
    } else {
      console.error("[control] server error:", e);
    }
  });

  return server;
}
