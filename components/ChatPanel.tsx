"use client";

import {
  Sparkles,
  Send,
  X,
  Loader2,
  Wrench,
  AlertTriangle,
  RotateCcw,
  ChevronDown,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChatMessage } from "@/lib/ai/types";

/**
 * Floating chat panel.
 *
 * - Bottom-right launcher button (collapsed) → expands into a 380×560 panel.
 * - Conversation state lives entirely in this component's React state. The
 *   server is stateless; we POST `{ message, history }` to /api/ai/chat each
 *   turn and replace local state with what the server returns.
 * - Tool calls are rendered as collapsible "action" rows so the user can
 *   debug what the agent did.
 */

interface UiTrace {
  toolCalls: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result: unknown;
  }>;
  provider?: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

interface UiTurn {
  /** Stable id for React. */
  id: string;
  user: string;
  assistant: string;
  trace?: UiTrace;
  error?: string;
  /** Timestamp for header display. */
  ts: number;
}

interface ApiResponse {
  ok: boolean;
  error?: string;
  code?: string;
  data?: {
    reply: string;
    messages: ChatMessage[];
    trace: UiTrace;
  };
}

const SUGGESTIONS = [
  "Which rentals are expiring this week?",
  "Show me overdue rentals.",
  "Give me a summary for this month.",
  "How much outstanding balance is there?",
];

export default function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<UiTurn[]>([]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [setupHint, setSetupHint] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || busy) return;

      const turn: UiTurn = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        user: message,
        assistant: "",
        ts: Date.now(),
      };
      setTurns((prev) => [...prev, turn]);
      setInput("");
      setBusy(true);
      setSetupHint(null);

      try {
        const r = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, history }),
        });
        const json = (await r.json()) as ApiResponse;
        if (!json.ok) {
          if (json.code === "AI_NOT_CONFIGURED") {
            setSetupHint(json.error ?? "AI is not configured.");
          }
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turn.id
                ? { ...t, error: json.error || "Request failed." }
                : t
            )
          );
        } else if (json.data) {
          setHistory(json.data.messages);
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turn.id
                ? {
                    ...t,
                    assistant: json.data!.reply,
                    trace: json.data!.trace,
                  }
                : t
            )
          );
          // If the agent changed any data, ping the dashboard to reload.
          const mutating = new Set([
            "addRental",
            "extendRental",
            "markReturned",
            "recordPayment",
            "deleteRental",
          ]);
          const didMutate = json.data.trace.toolCalls.some((c) =>
            mutating.has(c.name)
          );
          if (didMutate && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("drivelytics:cars-changed"));
          }
        }
      } catch (e) {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turn.id
              ? { ...t, error: (e as Error).message || "Network error" }
              : t
          )
        );
      } finally {
        setBusy(false);
        setTimeout(() => inputRef.current?.focus(), 30);
      }
    },
    [busy, history]
  );

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    if (!open) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, busy, open]);

  // Focus input when panel opens.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  const reset = () => {
    if (busy) return;
    setTurns([]);
    setHistory([]);
    setSetupHint(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-soft px-4 py-3 text-sm font-medium hover:scale-[1.02] transition"
          onClick={() => setOpen(true)}
          aria-label="Open AI assistant"
        >
          <Sparkles size={16} />
          Ask AI
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          className="fixed bottom-0 right-0 sm:bottom-5 sm:right-5 z-40 w-full sm:w-[380px] h-[80vh] sm:h-[560px] sm:max-h-[80vh] flex flex-col bg-white sm:rounded-2xl shadow-soft border border-slate-200 animate-scale-in overflow-hidden"
          role="dialog"
          aria-label="AI assistant"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-br from-brand-50 to-white">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 grid place-items-center">
                <Sparkles size={16} className="text-white" />
              </div>
              <div className="leading-tight">
                <div className="text-sm font-semibold text-slate-900">
                  Drivelytics AI
                </div>
                <div className="text-[11px] text-slate-500">
                  Operations assistant
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                className="btn-ghost !px-2 !py-1 text-slate-500"
                title="Clear conversation"
                onClick={reset}
                disabled={busy || turns.length === 0}
                aria-label="Clear conversation"
              >
                <RotateCcw size={14} />
              </button>
              <button
                className="btn-ghost !px-2 !py-1 text-slate-500"
                onClick={() => !busy && setOpen(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Setup hint */}
          {setupHint && (
            <div className="mx-3 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">AI not configured</div>
                <div className="mt-0.5 leading-snug">{setupHint}</div>
                <div className="mt-1 text-[11px] text-amber-800">
                  Add <code className="font-mono">OPENAI_API_KEY</code> (or
                  set <code className="font-mono">AI_PROVIDER=anthropic</code>{" "}
                  with{" "}
                  <code className="font-mono">ANTHROPIC_API_KEY</code>) to
                  your <code className="font-mono">.env</code>, then restart{" "}
                  <code className="font-mono">npm run dev</code>.
                </div>
              </div>
            </div>
          )}

          {/* Messages */}
          <div ref={scrollerRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {turns.length === 0 && (
              <div className="text-center mt-6">
                <div className="mx-auto h-12 w-12 rounded-2xl bg-brand-50 text-brand-600 grid place-items-center">
                  <Sparkles size={20} />
                </div>
                <div className="mt-3 text-sm font-medium text-slate-900">
                  Ask anything about your rentals
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  The assistant reads live data and can make changes.
                </div>
                <div className="mt-4 grid gap-2 px-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      className="text-left text-xs text-slate-700 rounded-lg border border-slate-200 hover:border-brand-300 hover:bg-brand-50/40 px-3 py-2 transition"
                      onClick={() => void send(s)}
                      disabled={busy}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t) => (
              <Turn key={t.id} turn={t} />
            ))}

            {busy && (
              <div className="flex items-center gap-2 text-xs text-slate-500 px-1">
                <Loader2 size={14} className="animate-spin" />
                Thinking…
              </div>
            )}
          </div>

          {/* Composer */}
          <form
            onSubmit={handleSubmit}
            className="border-t border-slate-100 p-2 bg-white"
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="Ask about rentals, customers, payments…"
                className="flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-200 focus:outline-none max-h-32"
                disabled={busy}
              />
              <button
                type="submit"
                className="btn-primary !px-3 !py-2"
                disabled={busy || !input.trim()}
                aria-label="Send"
              >
                {busy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
              </button>
            </div>
            <div className="mt-1 px-1 text-[10px] text-slate-400">
              Enter to send · Shift+Enter for newline · Esc to close
            </div>
          </form>
        </div>
      )}
    </>
  );
}

// --------------------------------------------------------------------------
// Subcomponents
// --------------------------------------------------------------------------

function Turn({ turn }: { turn: UiTurn }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-600 text-white px-3 py-2 text-sm whitespace-pre-wrap break-words">
          {turn.user}
        </div>
      </div>

      {turn.trace && turn.trace.toolCalls.length > 0 && (
        <ToolCallsBlock calls={turn.trace.toolCalls} />
      )}

      {(turn.assistant || turn.error) && (
        <div className="flex justify-start">
          <div
            className={`max-w-[90%] rounded-2xl rounded-tl-sm px-3 py-2 text-sm whitespace-pre-wrap break-words ${
              turn.error
                ? "bg-rose-50 text-rose-900 border border-rose-200"
                : "bg-slate-100 text-slate-900"
            }`}
          >
            {turn.error ? (
              <span className="inline-flex items-start gap-1.5">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{turn.error}</span>
              </span>
            ) : (
              turn.assistant
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolCallsBlock({
  calls,
}: {
  calls: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result: unknown;
  }>;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 transition"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="inline-flex items-center gap-1.5">
          <Wrench size={12} />
          <span className="font-medium">
            {calls.length} action{calls.length === 1 ? "" : "s"}:
          </span>{" "}
          <span className="text-slate-500">
            {calls.map((c) => c.name).join(", ")}
          </span>
        </span>
        <ChevronDown
          size={14}
          className={`transition-transform ${
            expanded ? "rotate-180" : ""
          } text-slate-400`}
        />
      </button>
      {expanded && (
        <div className="border-t border-slate-200 divide-y divide-slate-200">
          {calls.map((c, i) => (
            <div key={i} className="px-3 py-2 text-[11px]">
              <div className="font-mono text-slate-700">
                {c.name}({summarizeArgs(c.arguments)})
              </div>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-white border border-slate-200 px-2 py-1 text-[10px] leading-snug text-slate-700">
                {summarizeResult(c.result)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (!entries.length) return "";
  return entries
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ");
}

function summarizeResult(result: unknown): string {
  try {
    const json = JSON.stringify(result, null, 2);
    if (json.length > 1500) return json.slice(0, 1500) + "\n…(truncated)";
    return json;
  } catch {
    return String(result);
  }
}
