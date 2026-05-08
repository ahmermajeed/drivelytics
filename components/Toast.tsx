"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastCtx {
  notify: (kind: ToastKind, message: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast must be used within <ToastProvider>");
  return c;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const notify = useCallback(
    (kind: ToastKind, message: string) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, kind, message }]);
      setTimeout(() => remove(id), 3500);
    },
    [remove]
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[min(92vw,360px)]">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const Icon =
    toast.kind === "success"
      ? CheckCircle2
      : toast.kind === "error"
      ? AlertTriangle
      : Info;
  const tone =
    toast.kind === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : toast.kind === "error"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : "border-sky-200 bg-sky-50 text-sky-800";
  const iconTone =
    toast.kind === "success"
      ? "text-emerald-500"
      : toast.kind === "error"
      ? "text-rose-500"
      : "text-sky-500";

  useEffect(() => {
    // animate in via CSS class only (handled in className)
  }, []);

  return (
    <div
      className={`flex items-start gap-3 px-3.5 py-3 rounded-xl border shadow-soft animate-fade-in ${tone}`}
      role="status"
    >
      <Icon size={18} className={`mt-0.5 shrink-0 ${iconTone}`} />
      <div className="text-sm leading-snug flex-1">{toast.message}</div>
      <button
        onClick={onClose}
        className="text-slate-500 hover:text-slate-800 transition"
        aria-label="Dismiss notification"
      >
        <X size={16} />
      </button>
    </div>
  );
}
