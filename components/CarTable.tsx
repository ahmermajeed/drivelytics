"use client";

import { Pencil, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import type { Car } from "@/lib/types";
import { useMemo, useState } from "react";

type SortKey = keyof Car;
type SortDir = "asc" | "desc";

function fmtCurrency(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function fmtDate(s: string) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusOf(c: Car): { label: string; tone: string } {
  if (!c.rentedTill) return { label: "—", tone: "bg-slate-100 text-slate-600" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const till = new Date(c.rentedTill);
  if (isNaN(till.getTime()))
    return { label: "—", tone: "bg-slate-100 text-slate-600" };
  if (till < today)
    return { label: "Returned", tone: "bg-slate-100 text-slate-600" };
  const diff = Math.ceil((till.getTime() - today.getTime()) / 86_400_000);
  if (diff <= 3)
    return { label: `${diff}d left`, tone: "bg-amber-100 text-amber-800" };
  return { label: "Active", tone: "bg-emerald-100 text-emerald-700" };
}

interface Props {
  cars: Car[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (visibleIds: string[]) => void;
  onEdit: (car: Car) => void;
  onDelete: (car: Car) => void;
}

export default function CarTable({
  cars,
  selected,
  onToggleSelect,
  onToggleSelectAll,
  onEdit,
  onDelete,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("carName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => {
    const copy = [...cars];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [cars, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  const allSelected =
    sorted.length > 0 && sorted.every((c) => selected.has(c.id));
  const someSelected = !allSelected && sorted.some((c) => selected.has(c.id));

  const Th = ({
    label,
    k,
    align = "left",
    className = "",
  }: {
    label: string;
    k: SortKey;
    align?: "left" | "right" | "center";
    className?: string;
  }) => (
    <th
      className={`py-3 px-4 font-semibold text-slate-600 select-none ${className}`}
      style={{ textAlign: align }}
    >
      <button
        className="inline-flex items-center gap-1 hover:text-slate-900 transition"
        onClick={() => toggleSort(k)}
      >
        {label}
        {sortKey === k ? (
          sortDir === "asc" ? (
            <ChevronUp size={14} />
          ) : (
            <ChevronDown size={14} />
          )
        ) : (
          <ChevronUp size={14} className="opacity-0 group-hover:opacity-50" />
        )}
      </button>
    </th>
  );

  if (cars.length === 0) {
    return (
      <div className="card p-12 text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 grid place-items-center">
          <Pencil size={22} />
        </div>
        <h3 className="mt-4 text-base font-semibold text-slate-900">
          No rentals yet
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Click <span className="font-medium text-slate-700">“Add Rental”</span>{" "}
          to create your first record.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop / tablet: table */}
      <div className="hidden md:block card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/70 text-xs uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4 w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={() => onToggleSelectAll(sorted.map((c) => c.id))}
                  />
                </th>
                <Th label="Car" k="carName" />
                <Th label="Model" k="model" />
                <Th label="Rented To" k="rentedTo" />
                <Th label="Date Rented" k="dateRented" />
                <Th label="Rented Till" k="rentedTill" />
                <Th label="Price" k="rentedPrice" align="right" />
                <Th label="Advance" k="advancePaid" align="right" />
                <th className="py-3 px-4 font-semibold text-slate-600 text-center">
                  Status
                </th>
                <th className="py-3 px-4 w-28 text-right font-semibold text-slate-600">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((c) => {
                const isSel = selected.has(c.id);
                const st = statusOf(c);
                const balance =
                  (Number(c.rentedPrice) || 0) - (Number(c.advancePaid) || 0);
                return (
                  <tr
                    key={c.id}
                    className={`transition-colors ${
                      isSel ? "bg-brand-50/60" : "hover:bg-slate-50/60"
                    }`}
                  >
                    <td className="py-3 px-4">
                      <input
                        type="checkbox"
                        aria-label={`Select ${c.carName}`}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        checked={isSel}
                        onChange={() => onToggleSelect(c.id)}
                      />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white grid place-items-center text-xs font-bold uppercase">
                          {c.carName.slice(0, 2)}
                        </div>
                        <div>
                          <div className="font-medium text-slate-900">
                            {c.carName}
                          </div>
                          <div className="text-xs text-slate-500">{c.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-700">{c.model}</td>
                    <td className="py-3 px-4 text-slate-700">
                      {c.rentedTo ? (
                        c.rentedTo
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-700">
                      {fmtDate(c.dateRented)}
                    </td>
                    <td className="py-3 px-4 text-slate-700">
                      {fmtDate(c.rentedTill)}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-slate-900">
                      {fmtCurrency(c.rentedPrice)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="font-medium text-slate-900">
                        {fmtCurrency(c.advancePaid)}
                      </div>
                      <div
                        className={`text-[11px] ${
                          balance > 0
                            ? "text-amber-700"
                            : "text-emerald-700"
                        }`}
                      >
                        {balance > 0
                          ? `${fmtCurrency(balance)} due`
                          : "fully paid"}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`chip ${st.tone}`}>{st.label}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          className="btn-ghost !px-2 !py-2"
                          onClick={() => onEdit(c)}
                          aria-label={`Edit ${c.carName}`}
                          title="Edit"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="btn-ghost !px-2 !py-2 hover:bg-rose-50 hover:text-rose-600"
                          onClick={() => onDelete(c)}
                          aria-label={`Delete ${c.carName}`}
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile: cards */}
      <div className="md:hidden space-y-3">
        {sorted.map((c) => {
          const isSel = selected.has(c.id);
          const st = statusOf(c);
          const balance =
            (Number(c.rentedPrice) || 0) - (Number(c.advancePaid) || 0);
          return (
            <div
              key={c.id}
              className={`card p-4 ${isSel ? "ring-2 ring-brand-400" : ""}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  aria-label={`Select ${c.carName}`}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  checked={isSel}
                  onChange={() => onToggleSelect(c.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-slate-900 truncate">
                      {c.carName}
                    </div>
                    <span className={`chip ${st.tone}`}>{st.label}</span>
                  </div>
                  <div className="text-xs text-slate-500">{c.model}</div>
                  {c.rentedTo && (
                    <div className="mt-1 text-xs text-slate-600">
                      <span className="text-slate-400">Rented to: </span>
                      <span className="font-medium text-slate-800">
                        {c.rentedTo}
                      </span>
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-[11px] uppercase text-slate-400">
                        Date Rented
                      </div>
                      <div className="text-slate-700">
                        {fmtDate(c.dateRented)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase text-slate-400">
                        Rented Till
                      </div>
                      <div className="text-slate-700">
                        {fmtDate(c.rentedTill)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase text-slate-400">
                        Price
                      </div>
                      <div className="font-medium text-slate-900">
                        {fmtCurrency(c.rentedPrice)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase text-slate-400">
                        Advance
                      </div>
                      <div className="font-medium text-slate-900">
                        {fmtCurrency(c.advancePaid)}
                      </div>
                      <div
                        className={`text-[11px] ${
                          balance > 0 ? "text-amber-700" : "text-emerald-700"
                        }`}
                      >
                        {balance > 0
                          ? `${fmtCurrency(balance)} due`
                          : "fully paid"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-end gap-2">
                    <button
                      className="btn-secondary !py-2 !px-3"
                      onClick={() => onEdit(c)}
                    >
                      <Pencil size={14} /> Edit
                    </button>
                    <button
                      className="btn-secondary !py-2 !px-3 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200"
                      onClick={() => onDelete(c)}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
