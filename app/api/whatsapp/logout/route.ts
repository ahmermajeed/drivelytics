import { NextResponse } from "next/server";
import { workerAuthHeaders, workerBaseUrl } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 3000;

export async function POST() {
  try {
    const ctrl = AbortSignal.timeout(TIMEOUT_MS);
    const r = await fetch(`${workerBaseUrl()}/api/logout`, {
      method: "POST",
      signal: ctrl,
      cache: "no-store",
      headers: workerAuthHeaders(),
    });
    if (!r.ok && r.status !== 202) {
      return NextResponse.json(
        { ok: false, error: `Worker returned ${r.status}` },
        { status: 502 }
      );
    }
    return NextResponse.json(await r.json(), { status: r.status });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Worker offline" },
      { status: 503 }
    );
  }
}
