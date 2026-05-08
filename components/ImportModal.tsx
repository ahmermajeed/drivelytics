"use client";

import { useEffect, useRef, useState } from "react";
import {
  X,
  Upload,
  Loader2,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import type { ApiResponse } from "@/lib/types";

interface ImportReport {
  imported: number;
  skipped: number;
  totalRowsScanned: number;
  mapping: Record<string, string>;
  unmappedHeaders: string[];
  errors: { row: number; reason: string }[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: (report: ImportReport) => void;
}

const ACCEPT = ".xlsx,.xls,.csv";

const FIELD_LABEL: Record<string, string> = {
  id: "ID",
  carName: "Car Name",
  model: "Model",
  dateRented: "Date Rented",
  rentedTill: "Rented Till",
  rentedPrice: "Rented Price",
  advancePaid: "Advance Paid",
};

export default function ImportModal({ open, onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setMode("append");
      setBusy(false);
      setError(null);
      setReport(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const onPick = (f: File | null) => {
    setError(null);
    setReport(null);
    if (!f) {
      setFile(null);
      return;
    }
    const lower = f.name.toLowerCase();
    if (!/\.(xlsx|xls|csv)$/.test(lower)) {
      setError("Unsupported file. Use .xlsx, .xls, or .csv.");
      return;
    }
    setFile(f);
  };

  const onSubmit = async () => {
    if (!file) {
      setError("Please pick a file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", mode);
      const r = await fetch("/api/cars/import", { method: "POST", body: fd });
      const json = (await r.json()) as ApiResponse<ImportReport>;
      if (!json.ok || !json.data) {
        throw new Error(json.error || "Import failed");
      }
      setReport(json.data);
      onImported(json.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div className="card w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl animate-scale-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Import from Excel
            </h2>
            <p className="text-xs text-slate-500">
              Upload an .xlsx, .xls, or .csv file. Columns are matched
              automatically by header name.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="btn-ghost !px-2 !py-2"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) onPick(f);
            }}
            onClick={() => inputRef.current?.click()}
            className={`group cursor-pointer rounded-2xl border-2 border-dashed px-5 py-8 text-center transition
              ${
                dragOver
                  ? "border-brand-400 bg-brand-50"
                  : "border-slate-200 hover:border-brand-300 hover:bg-slate-50"
              }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
            <div className="mx-auto h-11 w-11 rounded-xl bg-brand-100 text-brand-700 grid place-items-center">
              <FileSpreadsheet size={20} />
            </div>
            {file ? (
              <>
                <p className="mt-3 text-sm font-medium text-slate-900">
                  {file.name}
                </p>
                <p className="text-xs text-slate-500">
                  {(file.size / 1024).toFixed(1)} KB · click to change
                </p>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm font-medium text-slate-800">
                  Click to browse, or drag & drop a file here
                </p>
                <p className="text-xs text-slate-500">
                  Supported: .xlsx, .xls, .csv (max 10 MB)
                </p>
              </>
            )}
          </div>

          {/* Mode */}
          <div>
            <p className="label">Import Mode</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode("append")}
                className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition ${
                  mode === "append"
                    ? "border-brand-400 bg-brand-50 text-brand-800 shadow-ring"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="block">Append</span>
                <span className="block text-[11px] font-normal text-slate-500">
                  Add uploaded rows to existing data
                </span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode("replace")}
                className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition ${
                  mode === "replace"
                    ? "border-rose-300 bg-rose-50 text-rose-800 shadow-ring"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="block">Replace</span>
                <span className="block text-[11px] font-normal text-slate-500">
                  Discard existing rows, keep only the upload
                </span>
              </button>
            </div>
          </div>

          {error && (
            <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {report && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <div className="flex items-start gap-2">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                <div className="flex-1">
                  <p className="font-medium">
                    Imported {report.imported} row
                    {report.imported === 1 ? "" : "s"} ·{" "}
                    {report.skipped} skipped
                  </p>
                  {Object.keys(report.mapping).length > 0 && (
                    <div className="mt-2 text-xs">
                      <span className="font-semibold">Column map: </span>
                      {Object.entries(report.mapping).map(([k, v], i, arr) => (
                        <span key={k}>
                          <span className="font-mono">{v}</span>
                          <span className="text-emerald-700"> → </span>
                          <span className="font-medium">
                            {FIELD_LABEL[k] ?? k}
                          </span>
                          {i < arr.length - 1 && ", "}
                        </span>
                      ))}
                    </div>
                  )}
                  {report.unmappedHeaders.length > 0 && (
                    <p className="mt-1 text-xs text-emerald-800/80">
                      Ignored columns: {report.unmappedHeaders.join(", ")}
                    </p>
                  )}
                  {report.errors.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs font-medium cursor-pointer">
                        {report.errors.length} row
                        {report.errors.length === 1 ? "" : "s"} skipped — see
                        why
                      </summary>
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {report.errors.slice(0, 10).map((er, i) => (
                          <li key={i}>
                            • Row {er.row}: {er.reason}
                          </li>
                        ))}
                        {report.errors.length > 10 && (
                          <li>… and {report.errors.length - 10} more</li>
                        )}
                      </ul>
                    </details>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 pb-5 flex items-center justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            {report ? "Done" : "Cancel"}
          </button>
          {!report && (
            <button
              type="button"
              className="btn-primary"
              onClick={onSubmit}
              disabled={busy || !file}
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Upload size={16} />
              )}
              Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
