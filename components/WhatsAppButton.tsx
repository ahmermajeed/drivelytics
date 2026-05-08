"use client";

import { useEffect, useState } from "react";
import WhatsAppModal from "./WhatsAppModal";

/**
 * Header button that surfaces WhatsApp worker state at a glance and opens
 * the pairing/management modal on click.
 *
 * Color dot legend:
 *   green  → connected and ready
 *   amber  → QR pending (needs scan)
 *   red    → disconnected (worker is up but not paired)
 *   gray   → worker offline (`npm run whatsapp` not running)
 */

export type WAStatus =
  | "open"
  | "connecting"
  | "qr_pending"
  | "disconnected"
  | "worker_offline";

export interface WAState {
  connection: WAStatus;
  jid: string | null;
  latestQR: string | null;
  lastUpdate: number;
}

const POLL_MS = 4000;

export default function WhatsAppButton() {
  const [state, setState] = useState<WAState>({
    connection: "worker_offline",
    jid: null,
    latestQR: null,
    lastUpdate: 0,
  });
  const [open, setOpen] = useState(false);

  // Background poll regardless of modal-open state, so the button dot is
  // always live. Polls less aggressively when the modal is closed.
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/whatsapp/status", { cache: "no-store" });
        const j = (await r.json()) as { ok: boolean; data?: WAState };
        if (active && j.ok && j.data) setState(j.data);
      } catch {
        if (active)
          setState((s) => ({ ...s, connection: "worker_offline" }));
      }
    };
    void tick();
    const id = window.setInterval(tick, open ? 1500 : POLL_MS);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [open]);

  const dotClass = dotForStatus(state.connection);
  const label = labelForStatus(state.connection);

  return (
    <>
      <button
        className="btn-secondary inline-flex items-center gap-2"
        onClick={() => setOpen(true)}
        title="WhatsApp connection"
      >
        <span className={`relative inline-flex h-2.5 w-2.5`}>
          <span
            className={`absolute inset-0 rounded-full ${dotClass} ${
              state.connection === "connecting" ||
              state.connection === "qr_pending"
                ? "animate-pulse"
                : ""
            }`}
          />
        </span>
        <span className="hidden sm:inline">WhatsApp</span>
        <span className="hidden md:inline text-xs text-slate-500">
          · {label}
        </span>
      </button>

      <WhatsAppModal
        open={open}
        state={state}
        onClose={() => setOpen(false)}
        onStateChange={setState}
      />
    </>
  );
}

function dotForStatus(s: WAStatus): string {
  switch (s) {
    case "open":
      return "bg-emerald-500";
    case "qr_pending":
      return "bg-amber-500";
    case "connecting":
      return "bg-sky-500";
    case "disconnected":
      return "bg-rose-500";
    case "worker_offline":
    default:
      return "bg-slate-400";
  }
}

function labelForStatus(s: WAStatus): string {
  switch (s) {
    case "open":
      return "connected";
    case "qr_pending":
      return "scan QR";
    case "connecting":
      return "connecting…";
    case "disconnected":
      return "disconnected";
    case "worker_offline":
    default:
      return "worker offline";
  }
}
