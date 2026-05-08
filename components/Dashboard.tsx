"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  RefreshCw,
  Trash2,
  Loader2,
  FileSpreadsheet,
  Sparkles,
  Upload,
  Download,
} from "lucide-react";
import StatsCards from "./StatsCards";
import CarTable from "./CarTable";
import CarFormModal, { type CarFormValue } from "./CarFormModal";
import ConfirmDialog from "./ConfirmDialog";
import ImportModal from "./ImportModal";
import ChatPanel from "./ChatPanel";
import WhatsAppButton from "./WhatsAppButton";
import { ToastProvider, useToast } from "./Toast";
import type { ApiResponse, Car } from "@/lib/types";

function DashboardInner() {
  const { notify } = useToast();
  const [cars, setCars] = useState<Car[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState<Car | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirm, setConfirm] = useState<{
    open: boolean;
    ids: string[];
    title: string;
    message: string;
  }>({ open: false, ids: [], title: "", message: "" });
  const [confirmBusy, setConfirmBusy] = useState(false);

  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const r = await fetch("/api/cars", { cache: "no-store" });
      const json = (await r.json()) as ApiResponse<Car[]>;
      if (!json.ok) throw new Error(json.error || "Failed to load");
      setCars(json.data ?? []);
    } catch (e) {
      notify("error", (e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  // The AI chat panel dispatches this event after any tool that mutates cars
  // so the table reflects the change without the user clicking Refresh.
  useEffect(() => {
    const onChanged = () => void load(true);
    window.addEventListener("drivelytics:cars-changed", onChanged);
    return () =>
      window.removeEventListener("drivelytics:cars-changed", onChanged);
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cars;
    return cars.filter(
      (c) =>
        c.carName.toLowerCase().includes(q) ||
        c.model.toLowerCase().includes(q) ||
        c.rentedTo.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
    );
  }, [cars, query]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (visibleIds: string[]) => {
    setSelected((prev) => {
      const allSelected = visibleIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleAddClick = () => {
    setFormInitial(null);
    setFormOpen(true);
  };

  const handleEdit = (car: Car) => {
    setFormInitial(car);
    setFormOpen(true);
  };

  const handleSubmitForm = async (v: CarFormValue) => {
    setSaving(true);
    try {
      const payload = {
        ...v,
        rentedPrice: typeof v.rentedPrice === "number" ? v.rentedPrice : 0,
        advancePaid: typeof v.advancePaid === "number" ? v.advancePaid : 0,
      };
      const isEdit = !!formInitial;
      const r = await fetch("/api/cars", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { id: formInitial!.id, ...payload } : payload),
      });
      const json = (await r.json()) as ApiResponse<Car>;
      if (!json.ok) throw new Error(json.error || "Save failed");
      notify("success", isEdit ? "Rental updated" : "Rental added");
      setFormOpen(false);
      await load(true);
    } catch (e) {
      notify("error", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const askDelete = (car: Car) => {
    setConfirm({
      open: true,
      ids: [car.id],
      title: "Delete rental?",
      message: `This will permanently remove “${car.carName}”. This action cannot be undone.`,
    });
  };

  const askBulkDelete = () => {
    if (selected.size === 0) return;
    setConfirm({
      open: true,
      ids: Array.from(selected),
      title: `Delete ${selected.size} rental${selected.size > 1 ? "s" : ""}?`,
      message:
        "The selected rows will be permanently removed. This action cannot be undone.",
    });
  };

  const performDelete = async () => {
    setConfirmBusy(true);
    try {
      const r = await fetch("/api/cars", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: confirm.ids }),
      });
      const json = (await r.json()) as ApiResponse<{ removed: number }>;
      if (!json.ok) throw new Error(json.error || "Delete failed");
      notify("success", `Deleted ${json.data?.removed ?? 0} record(s)`);
      setSelected(new Set());
      setConfirm({ open: false, ids: [], title: "", message: "" });
      await load(true);
    } catch (e) {
      notify("error", (e as Error).message);
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 grid place-items-center shadow-soft">
            <Sparkles size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Drivelytics
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 flex items-center gap-1.5">
              <FileSpreadsheet size={14} />
              Rental management dashboard ·{" "}
              <span className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded">
                Postgres
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-secondary"
            onClick={() => load(true)}
            disabled={refreshing || loading}
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw
              size={16}
              className={refreshing ? "animate-spin" : ""}
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            className="btn-secondary"
            onClick={() => setImportOpen(true)}
            title="Import from .xlsx, .xls, or .csv"
          >
            <Upload size={16} />
            <span className="hidden sm:inline">Import</span>
          </button>
          <a
            className="btn-secondary"
            href="/api/cars/export"
            title="Download cars.xlsx"
          >
            <Download size={16} />
            <span className="hidden sm:inline">Export</span>
          </a>
          <WhatsAppButton />
          <button className="btn-primary" onClick={handleAddClick}>
            <Plus size={16} />
            Add Rental
          </button>
        </div>
      </header>

      {/* Stats */}
      <section className="mb-6">
        <StatsCards cars={cars} />
      </section>

      {/* Toolbar */}
      <section className="card p-3 sm:p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by car, model, renter, or ID…"
            className="input !pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-slate-500 hidden sm:block">
            {filtered.length} of {cars.length} record
            {cars.length === 1 ? "" : "s"}
            {selected.size > 0 && (
              <>
                {" "}
                ·{" "}
                <span className="font-medium text-brand-700">
                  {selected.size} selected
                </span>
              </>
            )}
          </div>
          {selected.size > 0 && (
            <button className="btn-danger" onClick={askBulkDelete}>
              <Trash2 size={16} />
              Delete ({selected.size})
            </button>
          )}
        </div>
      </section>

      {/* Table */}
      <section>
        {loading ? (
          <div className="card p-12 flex items-center justify-center text-slate-500">
            <Loader2 size={20} className="animate-spin mr-2" />
            Loading rentals…
          </div>
        ) : (
          <CarTable
            cars={filtered}
            selected={selected}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onEdit={handleEdit}
            onDelete={askDelete}
          />
        )}
      </section>

      {/* Footer */}
      <footer className="mt-10 text-center text-xs text-slate-400">
        Built by{" "}
        <span className="font-medium text-slate-500">Ahmar Khan</span>
        {" · "}
        AI-powered Drivelytics
      </footer>

      {/* Modals */}
      <CarFormModal
        open={formOpen}
        initial={formInitial}
        saving={saving}
        onClose={() => !saving && setFormOpen(false)}
        onSubmit={handleSubmitForm}
      />
      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        confirmLabel="Delete"
        destructive
        busy={confirmBusy}
        onCancel={() =>
          !confirmBusy &&
          setConfirm({ open: false, ids: [], title: "", message: "" })
        }
        onConfirm={performDelete}
      />
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(rep) => {
          notify(
            "success",
            `Imported ${rep.imported} row${rep.imported === 1 ? "" : "s"}` +
              (rep.skipped ? ` · ${rep.skipped} skipped` : "")
          );
          void load(true);
        }}
      />
      <ChatPanel />
    </div>
  );
}

export default function Dashboard() {
  return (
    <ToastProvider>
      <DashboardInner />
    </ToastProvider>
  );
}
