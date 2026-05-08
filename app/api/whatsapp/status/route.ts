import { NextResponse } from "next/server";
import { workerAuthHeaders, workerBaseUrl } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxies to the WhatsApp worker's control plane.
 *
 * If the worker is offline (user hasn't run `npm run whatsapp` yet, or it
 * crashed), we return a friendly `{ connection: "worker_offline" }` rather
 * than an HTTP error, so the UI can render that distinct state cleanly.
 */

const TIMEOUT_MS = 1500;

export async function GET() {
  try {
    const ctrl = AbortSignal.timeout(TIMEOUT_MS);
    const r = await fetch(`${workerBaseUrl()}/api/status`, {
      signal: ctrl,
      cache: "no-store",
      headers: workerAuthHeaders(),
    });
    if (!r.ok) {
      return NextResponse.json(
        { ok: false, error: `Worker returned ${r.status}` },
        { status: 502 }
      );
    }
    const j = (await r.json()) as { ok: boolean; data: unknown };
    return NextResponse.json(j);
  } catch {
    return NextResponse.json({
      ok: true,
      data: {
        connection: "worker_offline",
        jid: null,
        latestQR: null,
        lastUpdate: Date.now(),
      },
    });
  }
}
