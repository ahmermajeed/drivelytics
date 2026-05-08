"use client";

import { useEffect, useRef, useState } from "react";
import { X, Save, Loader2 } from "lucide-react";
import type { Car } from "@/lib/types";

export interface CarFormValue {
  carName: string;
  model: string;
  rentedTo: string;
  dateRented: string;
  rentedTill: string;
  rentedPrice: number | "";
  advancePaid: number | "";
}

const empty: CarFormValue = {
  carName: "",
  model: "",
  rentedTo: "",
  dateRented: "",
  rentedTill: "",
  rentedPrice: "",
  advancePaid: "",
};

interface Props {
  open: boolean;
  initial?: Car | null;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (value: CarFormValue) => void | Promise<void>;
}

export default function CarFormModal({
  open,
  initial,
  saving = false,
  onClose,
  onSubmit,
}: Props) {
  const [value, setValue] = useState<CarFormValue>(empty);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(
        initial
          ? {
              carName: initial.carName,
              model: initial.model,
              rentedTo: initial.rentedTo ?? "",
              dateRented: initial.dateRented,
              rentedTill: initial.rentedTill,
              rentedPrice: initial.rentedPrice,
              advancePaid: initial.advancePaid,
            }
          : empty
      );
      setError(null);
      setTimeout(() => firstFieldRef.current?.focus(), 50);
    }
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const set = <K extends keyof CarFormValue>(k: K, v: CarFormValue[K]) =>
    setValue((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!value.carName.trim()) return setError("Car name is required.");
    if (!value.model.trim()) return setError("Model is required.");
    if (
      value.dateRented &&
      value.rentedTill &&
      new Date(value.rentedTill) < new Date(value.dateRented)
    ) {
      return setError("'Rented till' must be on or after 'Date rented'.");
    }
    if (typeof value.rentedPrice === "number" && value.rentedPrice < 0)
      return setError("Rented price cannot be negative.");
    if (typeof value.advancePaid === "number" && value.advancePaid < 0)
      return setError("Advance paid cannot be negative.");
    await onSubmit(value);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div className="card w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl animate-scale-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {initial ? "Edit Rental" : "New Rental"}
            </h2>
            <p className="text-xs text-slate-500">
              {initial
                ? "Update the rental record. Changes save instantly."
                : "Add a new rental record."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="btn-ghost !px-2 !py-2"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="carName">Car Name</label>
              <input
                ref={firstFieldRef}
                id="carName"
                className="input"
                placeholder="e.g. Toyota Corolla"
                value={value.carName}
                onChange={(e) => set("carName", e.target.value)}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="model">Model</label>
              <input
                id="model"
                className="input"
                placeholder="e.g. 2023 GLi"
                value={value.model}
                onChange={(e) => set("model", e.target.value)}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="rentedTo">Rented To</label>
              <input
                id="rentedTo"
                className="input"
                placeholder="e.g. Ahmed Khan / Acme Corp"
                value={value.rentedTo}
                onChange={(e) => set("rentedTo", e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="dateRented">Date Rented</label>
              <input
                id="dateRented"
                type="date"
                className="input"
                value={value.dateRented}
                onChange={(e) => set("dateRented", e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="rentedTill">Rented Till</label>
              <input
                id="rentedTill"
                type="date"
                className="input"
                value={value.rentedTill}
                onChange={(e) => set("rentedTill", e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="rentedPrice">Rented Price</label>
              <input
                id="rentedPrice"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className="input"
                placeholder="0.00"
                value={value.rentedPrice}
                onChange={(e) =>
                  set(
                    "rentedPrice",
                    e.target.value === "" ? "" : Number(e.target.value)
                  )
                }
              />
            </div>
            <div>
              <label className="label" htmlFor="advancePaid">Advance Paid</label>
              <input
                id="advancePaid"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className="input"
                placeholder="0.00"
                value={value.advancePaid}
                onChange={(e) =>
                  set(
                    "advancePaid",
                    e.target.value === "" ? "" : Number(e.target.value)
                  )
                }
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Save size={16} />
              )}
              {initial ? "Save changes" : "Add rental"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
