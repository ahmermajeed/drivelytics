"use client";

import { useEffect, useRef, useState } from "react";
import {
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  PowerOff,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import QRCode from "qrcode";
import type { WAState, WAStatus } from "./WhatsAppButton";

interface Props {
  open: boolean;
  state: WAState;
  onClose: () => void;
  onStateChange: (s: WAState) => void;
}

/**
 * Modal that exposes the WhatsApp worker's pairing UI.
 *
 * - Renders the QR string from the worker as a crisp SVG via the `qrcode`
 *   browser package (the worker also draws an ASCII QR in its terminal as
 *   a fallback).
 * - Polls /api/whatsapp/status every 1.5s while open so the user sees state
 *   transitions without refreshing.
 * - "Logout & re-pair" calls /api/whatsapp/logout which wipes auth state on
 *   the worker; a fresh QR appears here within ~1 second.
 */
export default function WhatsAppModal({
  open,
  state,
  onClose,
  onStateChange,
}: Props) {
  const [qrSvg, setQrSvg] = useState<string>("");
  const [busyLogout, setBusyLogout] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Render incoming QR string to SVG.
  useEffect(() => {
    let cancel = false;
    if (!state.latestQR) {
      setQrSvg("");
      return;
    }
    QRCode.toString(state.latestQR, {
      type: "svg",
      margin: 1,
      width: 280,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((svg) => {
        if (!cancel) setQrSvg(svg);
      })
      .catch((e: unknown) => {
        if (!cancel) setError(`Could not render QR: ${(e as Error).message}`);
      });
    return () => {
      cancel = true;
    };
  }, [state.latestQR]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyLogout) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busyLogout, onClose]);

  if (!open) return null;

  const handleLogout = async () => {
    if (busyLogout) return;
    setBusyLogout(true);
    setError(null);
    try {
      const r = await fetch("/api/whatsapp/logout", { method: "POST" });
      if (!r.ok && r.status !== 202) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `Worker returned ${r.status}`);
      }
      // Optimistic: state will catch up on next poll.
      onStateChange({
        ...state,
        connection: "disconnected",
        jid: null,
        latestQR: null,
      });
    } catch (e) {
      setError((e as Error).message || "Logout failed");
    } finally {
      setBusyLogout(false);
    }
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) =>
        e.target === e.currentTarget && !busyLogout && onClose()
      }
      role="dialog"
      aria-modal="true"
    >
      <div className="card w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Smartphone size={18} className="text-emerald-600" />
            <div className="leading-tight">
              <h2 className="text-base font-semibold text-slate-900">
                WhatsApp connection
              </h2>
              <p className="text-xs text-slate-500">
                Manage the bot's WhatsApp pairing
              </p>
            </div>
          </div>
          <button
            onClick={() => !busyLogout && onClose()}
            className="btn-ghost !px-2 !py-2"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
          <StatusBlock state={state} />

          {state.connection === "worker_offline" && <WorkerOfflineHint />}

          {state.connection === "qr_pending" && (
            <QrBlock qrSvg={qrSvg} hasQr={!!state.latestQR} />
          )}

          {state.connection === "connecting" && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2 size={16} className="animate-spin" />
              Establishing connection…
            </div>
          )}

          {state.connection === "open" && <ConnectedBlock state={state} />}

          {error && (
            <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 inline-flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50/40 rounded-b-2xl">
          <div className="text-[11px] text-slate-500">
            Worker port: <code className="font-mono">3001</code>
          </div>
          <div className="flex items-center gap-2">
            {state.connection === "open" && (
              <button
                className="btn-secondary !py-2 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 inline-flex items-center gap-1.5"
                onClick={handleLogout}
                disabled={busyLogout}
              >
                {busyLogout ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <PowerOff size={14} />
                )}
                Logout & re-pair
              </button>
            )}
            <button
              className="btn-secondary !py-2"
              onClick={() => !busyLogout && onClose()}
              disabled={busyLogout}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Subcomponents
// --------------------------------------------------------------------------

function StatusBlock({ state }: { state: WAState }) {
  const meta = STATUS_META[state.connection];
  return (
    <div
      className={`rounded-lg border ${meta.border} ${meta.bg} px-3 py-2.5 flex items-start gap-2`}
    >
      <span
        className={`mt-0.5 inline-block h-2.5 w-2.5 rounded-full ${meta.dot}`}
      />
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium ${meta.text}`}>{meta.label}</div>
        <div className="text-xs text-slate-600">{meta.subtitle}</div>
      </div>
    </div>
  );
}

function ConnectedBlock({ state }: { state: WAState }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm">
      <div className="inline-flex items-center gap-2 text-emerald-700">
        <CheckCircle2 size={16} />
        Connected
      </div>
      {state.jid && (
        <div className="mt-1.5 font-mono text-[11px] text-slate-600 break-all">
          {state.jid}
        </div>
      )}
      <div className="mt-2 text-xs text-slate-500">
        Send a WhatsApp message from any allowlisted phone to test.
      </div>
    </div>
  );
}

function QrBlock({ qrSvg, hasQr }: { qrSvg: string; hasQr: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="px-3 py-2.5 border-b border-slate-100">
        <div className="text-sm font-medium text-slate-900">
          Scan with WhatsApp on your phone
        </div>
        <div className="mt-0.5 text-xs text-slate-600">
          Open WhatsApp → Settings → Linked Devices → Link a Device
        </div>
      </div>
      <div className="p-4 grid place-items-center min-h-[300px]">
        {hasQr && qrSvg ? (
          <div
            className="w-[280px] h-[280px]"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        ) : (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={14} className="animate-spin" />
            Waiting for QR from worker…
          </div>
        )}
      </div>
      <div className="px-3 py-2 border-t border-slate-100 text-[11px] text-slate-500 inline-flex items-center gap-1">
        <RefreshCw size={11} />
        QR refreshes automatically every ~30 seconds
      </div>
    </div>
  );
}

function WorkerOfflineHint() {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
      <div className="font-medium text-slate-900">
        Worker not running
      </div>
      <div className="mt-1 text-xs text-slate-600">
        Open a second terminal in this project and run:
      </div>
      <pre className="mt-2 bg-white border border-slate-200 rounded px-2 py-1.5 text-[11px] font-mono text-slate-800 overflow-auto">
        npm run whatsapp
      </pre>
      <div className="mt-2 text-[11px] text-slate-500">
        This page polls every few seconds and will update once the worker is
        up.
      </div>
    </div>
  );
}

const STATUS_META: Record<
  WAStatus,
  {
    label: string;
    subtitle: string;
    border: string;
    bg: string;
    dot: string;
    text: string;
  }
> = {
  open: {
    label: "Connected",
    subtitle: "Bot is paired and ready to receive messages.",
    border: "border-emerald-200",
    bg: "bg-emerald-50",
    dot: "bg-emerald-500",
    text: "text-emerald-900",
  },
  qr_pending: {
    label: "Waiting for pairing",
    subtitle: "Scan the QR code below with WhatsApp on your phone.",
    border: "border-amber-200",
    bg: "bg-amber-50",
    dot: "bg-amber-500",
    text: "text-amber-900",
  },
  connecting: {
    label: "Connecting…",
    subtitle: "Negotiating with WhatsApp servers.",
    border: "border-sky-200",
    bg: "bg-sky-50",
    dot: "bg-sky-500",
    text: "text-sky-900",
  },
  disconnected: {
    label: "Disconnected",
    subtitle: "Worker is up but not paired. A QR should appear shortly.",
    border: "border-rose-200",
    bg: "bg-rose-50",
    dot: "bg-rose-500",
    text: "text-rose-900",
  },
  worker_offline: {
    label: "Worker offline",
    subtitle: "Run `npm run whatsapp` in another terminal to start it.",
    border: "border-slate-200",
    bg: "bg-slate-50",
    dot: "bg-slate-400",
    text: "text-slate-800",
  },
};
