import { NextResponse } from "next/server";
import { runAgent } from "@/lib/ai/agent";
import { AIConfigError } from "@/lib/ai/providers";
import type { ChatMessage } from "@/lib/ai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequestBody {
  message?: string;
  history?: ChatMessage[];
}

const MAX_HISTORY_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4000;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as ChatRequestBody;
    const message = String(body.message ?? "").trim();
    if (!message) {
      return NextResponse.json(
        { ok: false, error: "Missing 'message' in request body." },
        { status: 400 }
      );
    }
    if (message.length > MAX_MESSAGE_CHARS) {
      return NextResponse.json(
        {
          ok: false,
          error: `Message too long (max ${MAX_MESSAGE_CHARS} characters).`,
        },
        { status: 413 }
      );
    }

    // Trim absurdly long histories — the model has finite context, and
    // running away on tokens is the most common cost incident.
    const history = (Array.isArray(body.history) ? body.history : []).slice(
      -MAX_HISTORY_MESSAGES
    );

    const out = await runAgent({ userMessage: message, history });

    return NextResponse.json({
      ok: true,
      data: {
        reply: out.reply,
        messages: out.messages,
        trace: out.trace,
      },
    });
  } catch (e) {
    if (e instanceof AIConfigError) {
      return NextResponse.json(
        {
          ok: false,
          error: e.message,
          code: "AI_NOT_CONFIGURED",
        },
        { status: 503 }
      );
    }
    console.error("[api/ai/chat]", e);
    return NextResponse.json(
      { ok: false, error: (e as Error).message || "Agent failed." },
      { status: 500 }
    );
  }
}
