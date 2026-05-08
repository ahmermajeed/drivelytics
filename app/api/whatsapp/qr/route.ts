import { NextResponse } from "next/server";
import { workerAuthHeaders, workerBaseUrl } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 1500;

export async function GET() {
  try {
    const ctrl = AbortSignal.timeout(TIMEOUT_MS);
    const r = await fetch(`${workerBaseUrl()}/api/qr`, {
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
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json(
      { ok: false, error: "Worker offline" },
      { status: 503 }
    );
  }
}
