"use client";

import {
  Car as CarIcon,
  BadgeDollarSign,
  CalendarClock,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Car } from "@/lib/types";

function fmtCurrency(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  Icon: LucideIcon;
  gradient: string;
  iconBg: string;
}

function StatCard({ label, value, hint, Icon, gradient, iconBg }: StatCardProps) {
  return (
    <div className="card relative overflow-hidden p-5">
      <div
        className={`pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full opacity-30 blur-2xl ${gradient}`}
      />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900 tracking-tight">
            {value}
          </p>
          {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
        <div className={`p-2.5 rounded-xl ${iconBg}`}>
          <Icon size={18} className="text-white" />
        </div>
      </div>
    </div>
  );
}

export default function StatsCards({ cars }: { cars: Car[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totalCars = cars.length;
  let active = 0;
  let revenue = 0;
  let outstanding = 0;

  for (const c of cars) {
    revenue += Number(c.rentedPrice) || 0;
    outstanding += Math.max(
      0,
      (Number(c.rentedPrice) || 0) - (Number(c.advancePaid) || 0)
    );
    if (c.rentedTill) {
      const t = new Date(c.rentedTill);
      if (!isNaN(t.getTime()) && t >= today) active += 1;
    }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        label="Total Cars"
        value={String(totalCars)}
        hint={totalCars === 0 ? "Add your first car" : "in fleet"}
        Icon={CarIcon}
        gradient="bg-gradient-to-br from-indigo-400 to-violet-500"
        iconBg="bg-gradient-to-br from-indigo-500 to-violet-600"
      />
      <StatCard
        label="Active Rentals"
        value={String(active)}
        hint={`${totalCars - active} returned/expired`}
        Icon={CalendarClock}
        gradient="bg-gradient-to-br from-sky-400 to-cyan-500"
        iconBg="bg-gradient-to-br from-sky-500 to-cyan-600"
      />
      <StatCard
        label="Total Revenue"
        value={fmtCurrency(revenue)}
        hint="across all rentals"
        Icon={BadgeDollarSign}
        gradient="bg-gradient-to-br from-emerald-400 to-teal-500"
        iconBg="bg-gradient-to-br from-emerald-500 to-teal-600"
      />
      <StatCard
        label="Outstanding"
        value={fmtCurrency(outstanding)}
        hint="balance due from advance"
        Icon={Wallet}
        gradient="bg-gradient-to-br from-amber-400 to-orange-500"
        iconBg="bg-gradient-to-br from-amber-500 to-orange-600"
      />
    </div>
  );
}
