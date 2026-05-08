import type { Car as PrismaCar } from "@prisma/client";
import { prisma } from "./prisma";
import type { Car } from "./types";

/**
 * Postgres-backed data access for cars/rentals.
 *
 * This module replaces the data-store responsibilities of the old
 * `lib/excel.ts`. xlsx import/export now lives in `lib/xlsx-io.ts` and calls
 * into here just like any other consumer.
 *
 * The public function names match the previous API so existing callers in
 * `app/api/cars/*` keep working unchanged.
 */

// --------------------------------------------------------------------------
// Conversion: DB row <-> API shape
// --------------------------------------------------------------------------

/**
 * Convert a Prisma row to the shape the rest of the app expects.
 *
 * The dashboard treats `dateRented` and `rentedTill` as ISO date *strings*
 * (`YYYY-MM-DD`). Postgres stores them as `DATE`. We normalize at the
 * boundary so the frontend keeps the exact same contract it had under xlsx.
 */
function toApiCar(row: PrismaCar): Car {
  return {
    id: row.id,
    carName: row.carName,
    model: row.model,
    rentedTo: row.rentedTo ?? "",
    dateRented: row.dateRented ? toIsoDateString(row.dateRented) : "",
    rentedTill: row.rentedTill ? toIsoDateString(row.rentedTill) : "",
    rentedPrice: Number(row.rentedPrice) || 0,
    advancePaid: Number(row.advancePaid) || 0,
  };
}

function toIsoDateString(d: Date): string {
  // Use UTC components so a date stored as 2025-06-15 round-trips to
  // "2025-06-15" regardless of the server's local timezone.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Parse an ISO date string into a `Date` anchored at UTC midnight, or `null`
 * if the input is empty / unparseable. Anchoring at UTC midnight matches how
 * the old xlsx layer treated bare `YYYY-MM-DD` values.
 */
function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  return null;
}

// --------------------------------------------------------------------------
// IDs
// --------------------------------------------------------------------------

export function genId(): string {
  return `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// --------------------------------------------------------------------------
// CRUD — drop-in replacement for the legacy `lib/excel.ts` exports.
// --------------------------------------------------------------------------

export async function getAllCars(): Promise<Car[]> {
  const rows = await prisma.car.findMany({
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toApiCar);
}

export async function getCarById(id: string): Promise<Car | null> {
  if (!id) return null;
  const row = await prisma.car.findUnique({ where: { id } });
  return row ? toApiCar(row) : null;
}

export interface CarInput {
  id?: string;
  carName: string;
  model: string;
  rentedTo?: string;
  dateRented?: string;
  rentedTill?: string;
  rentedPrice?: number | string;
  advancePaid?: number | string;
}

/** Empty/whitespace strings are stored as null so the column is "unset". */
function nullableString(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t ? t : null;
}

export async function addCar(input: CarInput): Promise<Car> {
  const row = await prisma.car.create({
    data: {
      id: input.id?.trim() || genId(),
      carName: String(input.carName ?? "").trim(),
      model: String(input.model ?? "").trim(),
      rentedTo: nullableString(input.rentedTo),
      dateRented: parseDate(input.dateRented),
      rentedTill: parseDate(input.rentedTill),
      rentedPrice: Number(input.rentedPrice) || 0,
      advancePaid: Number(input.advancePaid) || 0,
    },
  });
  return toApiCar(row);
}

export async function updateCar(
  id: string,
  patch: Partial<CarInput>
): Promise<Car | null> {
  const existing = await prisma.car.findUnique({ where: { id } });
  if (!existing) return null;

  // Only set fields the caller actually provided — `undefined` means leave
  // alone, while empty string for a date means "clear it".
  const data: Record<string, unknown> = {};
  if (patch.carName !== undefined) data.carName = String(patch.carName).trim();
  if (patch.model !== undefined) data.model = String(patch.model).trim();
  if (patch.rentedTo !== undefined) data.rentedTo = nullableString(patch.rentedTo);
  if (patch.dateRented !== undefined) data.dateRented = parseDate(patch.dateRented);
  if (patch.rentedTill !== undefined) data.rentedTill = parseDate(patch.rentedTill);
  if (patch.rentedPrice !== undefined) data.rentedPrice = Number(patch.rentedPrice) || 0;
  if (patch.advancePaid !== undefined) data.advancePaid = Number(patch.advancePaid) || 0;

  const row = await prisma.car.update({ where: { id }, data });
  return toApiCar(row);
}

export async function deleteCars(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const res = await prisma.car.deleteMany({ where: { id: { in: ids } } });
  return res.count;
}

// --------------------------------------------------------------------------
// Bulk operations used by the xlsx import flow.
// --------------------------------------------------------------------------

export interface BulkCar {
  id: string;
  carName: string;
  model: string;
  rentedTo: string;   // "" when unset
  dateRented: string; // ISO date string or empty
  rentedTill: string;
  rentedPrice: number;
  advancePaid: number;
}

function bulkRowToData(r: BulkCar) {
  return {
    id: r.id,
    carName: r.carName,
    model: r.model,
    rentedTo: nullableString(r.rentedTo),
    dateRented: parseDate(r.dateRented),
    rentedTill: parseDate(r.rentedTill),
    rentedPrice: r.rentedPrice,
    advancePaid: r.advancePaid,
  };
}

/**
 * Replace the entire table with the given rows in a single transaction.
 * Used by xlsx import in "replace" mode.
 */
export async function replaceAllCars(rows: BulkCar[]): Promise<number> {
  await prisma.$transaction([
    prisma.car.deleteMany({}),
    prisma.car.createMany({ data: rows.map(bulkRowToData) }),
  ]);
  return rows.length;
}

/**
 * Append rows. Caller is responsible for ensuring `id` doesn't collide with
 * existing rows (the xlsx import does this up-front).
 */
export async function appendCars(rows: BulkCar[]): Promise<number> {
  if (!rows.length) return 0;
  const res = await prisma.car.createMany({
    data: rows.map(bulkRowToData),
    skipDuplicates: true,
  });
  return res.count;
}

export async function getExistingIds(): Promise<Set<string>> {
  const rows = await prisma.car.findMany({ select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

// --------------------------------------------------------------------------
// Higher-level helpers used by the AI tool layer.
// --------------------------------------------------------------------------

export type RentalStatus =
  | "active"     // rentedTill is today or in the future
  | "expiring"   // active AND rentedTill within N days (caller supplies N)
  | "overdue"    // rentedTill is in the past
  | "returned"   // alias of overdue, useful in NL queries
  | "no_dates";  // no rentedTill set

export interface EnrichedCar extends Car {
  status: RentalStatus;
  /** Days until rentedTill — negative if overdue, null if no end date. */
  daysUntilDue: number | null;
  balance: number;
}

/** UTC midnight of "today" — matches how dates are stored. */
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function diffDaysUtc(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

export function enrich(c: Car): EnrichedCar {
  const balance = (Number(c.rentedPrice) || 0) - (Number(c.advancePaid) || 0);
  if (!c.rentedTill) {
    return { ...c, status: "no_dates", daysUntilDue: null, balance };
  }
  const till = parseDate(c.rentedTill);
  if (!till) {
    return { ...c, status: "no_dates", daysUntilDue: null, balance };
  }
  const days = diffDaysUtc(till, todayUtc());
  const status: RentalStatus = days < 0 ? "overdue" : "active";
  return { ...c, status, daysUntilDue: days, balance };
}

export interface ListFilter {
  status?: "all" | "active" | "expiring" | "overdue" | "returned" | "no_dates";
  /** When status === "expiring", how many days ahead to consider. Default 7. */
  expiringWithinDays?: number;
  /** Free-text match across carName, model, rentedTo, id. */
  search?: string;
  /** Hard cap on rows returned. Default 50. */
  limit?: number;
}

export async function listEnriched(filter: ListFilter = {}): Promise<EnrichedCar[]> {
  const cars = await getAllCars();
  const all = cars.map(enrich);

  let rows = all;
  const days = filter.expiringWithinDays ?? 7;

  if (filter.status && filter.status !== "all") {
    rows = rows.filter((r) => {
      switch (filter.status) {
        case "active":
          return r.status === "active";
        case "overdue":
        case "returned":
          return r.status === "overdue";
        case "expiring":
          return (
            r.status === "active" &&
            r.daysUntilDue !== null &&
            r.daysUntilDue >= 0 &&
            r.daysUntilDue <= days
          );
        case "no_dates":
          return r.status === "no_dates";
        default:
          return true;
      }
    });
  }

  if (filter.search) {
    const q = filter.search.toLowerCase().trim();
    if (q) {
      rows = rows.filter(
        (r) =>
          r.carName.toLowerCase().includes(q) ||
          r.model.toLowerCase().includes(q) ||
          r.rentedTo.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q)
      );
    }
  }

  // Stable order: due-soonest first for active/expiring, then no-dates last.
  rows.sort((a, b) => {
    const aDue = a.daysUntilDue ?? Number.POSITIVE_INFINITY;
    const bDue = b.daysUntilDue ?? Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    return a.carName.localeCompare(b.carName);
  });

  return rows.slice(0, filter.limit ?? 50);
}

export async function fuzzyFindOne(query: string): Promise<EnrichedCar | null> {
  const q = query.trim();
  if (!q) return null;
  // Try exact id first, then fuzzy.
  const byId = await getCarById(q);
  if (byId) return enrich(byId);
  const matches = await listEnriched({ search: q, limit: 5 });
  if (matches.length === 0) return null;
  // Prefer exact name match if multiple, otherwise the first.
  const exact = matches.find(
    (m) =>
      m.carName.toLowerCase() === q.toLowerCase() ||
      m.rentedTo.toLowerCase() === q.toLowerCase()
  );
  return exact ?? matches[0];
}

export interface StatsPeriod {
  /** "today" | "week" | "month" | "all" */
  period?: "today" | "week" | "month" | "all";
}

export interface Stats {
  period: NonNullable<StatsPeriod["period"]>;
  totalCars: number;
  active: number;
  overdue: number;
  expiringNext7Days: number;
  totalRevenue: number;
  totalAdvancePaid: number;
  outstandingBalance: number;
  /** Counts of new rentals whose dateRented falls inside the period. */
  newRentalsInPeriod: number;
  /** Sum of rentedPrice for rentals whose dateRented falls inside the period. */
  revenueInPeriod: number;
}

function periodStartUtc(period: StatsPeriod["period"]): Date | null {
  const today = todayUtc();
  switch (period) {
    case "today":
      return today;
    case "week": {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - 6);
      return d;
    }
    case "month": {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - 29);
      return d;
    }
    case "all":
    default:
      return null;
  }
}

export async function getStats(opts: StatsPeriod = {}): Promise<Stats> {
  const period = opts.period ?? "all";
  const cars = await getAllCars();
  const enriched = cars.map(enrich);

  const start = periodStartUtc(period);
  let newRentalsInPeriod = 0;
  let revenueInPeriod = 0;
  let totalRevenue = 0;
  let totalAdvancePaid = 0;
  let active = 0;
  let overdue = 0;
  let expiring = 0;

  for (const r of enriched) {
    totalRevenue += Number(r.rentedPrice) || 0;
    totalAdvancePaid += Number(r.advancePaid) || 0;
    if (r.status === "active") active++;
    if (r.status === "overdue") overdue++;
    if (
      r.status === "active" &&
      r.daysUntilDue !== null &&
      r.daysUntilDue >= 0 &&
      r.daysUntilDue <= 7
    ) {
      expiring++;
    }

    if (start && r.dateRented) {
      const d = parseDate(r.dateRented);
      if (d && d.getTime() >= start.getTime()) {
        newRentalsInPeriod++;
        revenueInPeriod += Number(r.rentedPrice) || 0;
      }
    }
  }

  return {
    period,
    totalCars: enriched.length,
    active,
    overdue,
    expiringNext7Days: expiring,
    totalRevenue,
    totalAdvancePaid,
    outstandingBalance: totalRevenue - totalAdvancePaid,
    newRentalsInPeriod: start ? newRentalsInPeriod : enriched.length,
    revenueInPeriod: start ? revenueInPeriod : totalRevenue,
  };
}

/**
 * Add `amount` to advancePaid. Returns the updated car or null if not found.
 * `amount` may be 0 (no-op) but must be non-negative.
 */
export async function recordPayment(
  id: string,
  amount: number
): Promise<Car | null> {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Payment amount must be a non-negative number.");
  }
  const existing = await prisma.car.findUnique({ where: { id } });
  if (!existing) return null;
  const row = await prisma.car.update({
    where: { id },
    data: { advancePaid: (Number(existing.advancePaid) || 0) + amount },
  });
  return toApiCar(row);
}

/**
 * Set rentedTill to a new date (extension). Returns the updated car or null.
 * Validates that the new date is on/after dateRented when both are present.
 */
export async function extendRentalTill(
  id: string,
  newRentedTill: string
): Promise<Car | null> {
  const newDate = parseDate(newRentedTill);
  if (!newDate) {
    throw new Error("newRentedTill must be a valid YYYY-MM-DD date.");
  }
  const existing = await prisma.car.findUnique({ where: { id } });
  if (!existing) return null;
  if (existing.dateRented && newDate < existing.dateRented) {
    throw new Error(
      "newRentedTill cannot be earlier than dateRented."
    );
  }
  const row = await prisma.car.update({
    where: { id },
    data: { rentedTill: newDate },
  });
  return toApiCar(row);
}

/**
 * "Mark as returned" by setting rentedTill to today's date. The current
 * schema doesn't have a separate "returned" flag — a rental is considered
 * returned when its rentedTill is in the past (or today).
 */
export async function markRentalReturned(id: string): Promise<Car | null> {
  const existing = await prisma.car.findUnique({ where: { id } });
  if (!existing) return null;
  const row = await prisma.car.update({
    where: { id },
    data: { rentedTill: todayUtc() },
  });
  return toApiCar(row);
}
