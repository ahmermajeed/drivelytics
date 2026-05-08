/**
 * Shared helpers for the /api/whatsapp/* proxy routes.
 *
 * The dashboard browser hits these same-origin endpoints, which forward to
 * wherever the WhatsApp worker's control plane is reachable:
 *
 *   - Locally: http://127.0.0.1:3001 (the default)
 *   - Deployed: WA_CONTROL_BASE_URL=https://your-worker.example.com
 *               WA_CONTROL_TOKEN=<long random string>
 *
 * The token is injected as `Authorization: Bearer ...`. When it's empty we
 * still send no Authorization header — fine for local dev. The worker
 * refuses to start in unsafe combinations (public bind without a token).
 */

export function workerBaseUrl(): string {
  if (process.env.WA_CONTROL_BASE_URL) {
    return process.env.WA_CONTROL_BASE_URL.replace(/\/+$/, "");
  }
  const port = process.env.WA_CONTROL_PORT ?? "3001";
  return `http://127.0.0.1:${port}`;
}

export function workerAuthHeaders(): HeadersInit {
  const token = process.env.WA_CONTROL_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
