import { NextResponse } from "next/server";
import { importFromBuffer } from "@/lib/xlsx-io";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXT = [".xlsx", ".xls", ".csv"] as const;

export async function POST(req: Request) {
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (!ct.includes("multipart/form-data")) {
      return NextResponse.json(
        { ok: false, error: "Expected multipart/form-data" },
        { status: 400 }
      );
    }

    const fd = await req.formData();
    const file = fd.get("file");
    const mode = String(fd.get("mode") ?? "append").toLowerCase();

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Missing 'file' field" },
        { status: 400 }
      );
    }
    const filename = file.name || "upload";
    const lower = filename.toLowerCase();
    if (!ALLOWED_EXT.some((ext) => lower.endsWith(ext))) {
      return NextResponse.json(
        {
          ok: false,
          error: `Unsupported file type. Allowed: ${ALLOWED_EXT.join(", ")}`,
        },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: `File too large. Max ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB`,
        },
        { status: 413 }
      );
    }
    if (mode !== "replace" && mode !== "append") {
      return NextResponse.json(
        { ok: false, error: "Mode must be 'replace' or 'append'" },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const report = await importFromBuffer(buf, filename, {
      mode: mode as "replace" | "append",
    });

    return NextResponse.json({ ok: true, data: report });
  } catch (e) {
    const msg = (e as Error).message || "Import failed";
    console.error("[api/cars/import]", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
