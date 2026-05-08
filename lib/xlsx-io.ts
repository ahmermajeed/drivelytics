import * as XLSX from "xlsx";
import {
  appendCars,
  type BulkCar,
  genId,
  getAllCars,
  getExistingIds,
  replaceAllCars,
} from "./cars";
import type { Car } from "./types";

/**
 * Pure xlsx I/O — parses uploaded files into rows and serializes the DB into
 * a downloadable workbook. All persistence delegates to `lib/cars.ts`.
 *
 * No filesystem reads/writes happen here; the canonical store is Postgres.
 */

const SHEET_NAME = "Cars";

const HEADERS: (keyof Car)[] = [
  "id",
  "carName",
  "model",
  "rentedTo",
  "dateRented",
  "rentedTill",
  "rentedPrice",
  "advancePaid",
];

// --------------------------------------------------------------------------
// Header normalization for arbitrary uploaded files
// --------------------------------------------------------------------------

function normHeader(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const HEADER_ALIASES: Record<keyof Car, string[]> = {
  id: ["id", "rentalid", "recordid"],
  carName: ["carname", "car", "name", "vehicle", "vehiclename"],
  model: ["model", "carmodel", "variant", "trim"],
  rentedTo: [
    "rentedto",
    "rentedtouser",
    "rentedby",
    "renter",
    "rentername",
    "user",
    "username",
    "customer",
    "customername",
    "client",
    "clientname",
    "guest",
    "guestname",
    "tenant",
  ],
  dateRented: [
    "daterented",
    "rentedon",
    "startdate",
    "from",
    "datefrom",
    "rentstart",
    "start",
    "pickupdate",
    "pickup",
  ],
  rentedTill: [
    "rentedtill",
    "enddate",
    "until",
    "to",
    "dateto",
    "rentend",
    "end",
    "returndate",
    "dropoff",
    "dropoffdate",
  ],
  rentedPrice: [
    "rentedprice",
    "price",
    "rent",
    "amount",
    "totalprice",
    "total",
    "rentalprice",
    "rental",
    "fee",
    "cost",
  ],
  advancePaid: [
    "advancepaid",
    "advance",
    "deposit",
    "downpayment",
    "paid",
    "advanceamount",
    "prepaid",
  ],
};

function buildAliasIndex(): Map<string, keyof Car> {
  const m = new Map<string, keyof Car>();
  for (const k of Object.keys(HEADER_ALIASES) as (keyof Car)[]) {
    for (const alias of HEADER_ALIASES[k]) m.set(alias, k);
  }
  return m;
}

const ALIAS_INDEX = buildAliasIndex();

// --------------------------------------------------------------------------
// Cell coercion
// --------------------------------------------------------------------------

function toIsoDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const y = parsed.y;
      const m = String(parsed.m).padStart(2, "0");
      const d = String(parsed.d).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  }
  const s = String(value).trim();
  if (!s) return "";
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }
  return s;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/[^\d.\-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// --------------------------------------------------------------------------
// Import
// --------------------------------------------------------------------------

export interface ImportReport {
  imported: number;
  skipped: number;
  totalRowsScanned: number;
  mapping: Partial<Record<keyof Car, string>>;
  unmappedHeaders: string[];
  errors: { row: number; reason: string }[];
}

interface ImportOptions {
  mode: "replace" | "append";
}

export async function importFromBuffer(
  buffer: Buffer,
  filename: string,
  opts: ImportOptions
): Promise<ImportReport> {
  const lower = filename.toLowerCase();
  const isCsv = lower.endsWith(".csv");

  const wb = isCsv
    ? XLSX.read(buffer.toString("utf8"), { type: "string", cellDates: true })
    : XLSX.read(buffer, { type: "buffer", cellDates: true });

  const wsName = wb.SheetNames[0];
  const ws = wsName ? wb.Sheets[wsName] : null;
  if (!ws) throw new Error("The uploaded file has no readable sheet.");

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    blankrows: false,
  });
  if (aoa.length === 0) {
    return {
      imported: 0,
      skipped: 0,
      totalRowsScanned: 0,
      mapping: {},
      unmappedHeaders: [],
      errors: [],
    };
  }

  const headerRow = aoa[0] as unknown[];
  const colToField = new Map<number, keyof Car>();
  const mapping: Partial<Record<keyof Car, string>> = {};
  const unmappedHeaders: string[] = [];

  const displayHeader = (raw: unknown): string =>
    String(raw ?? "").replace(/^\uFEFF/, "").trim();

  headerRow.forEach((raw, idx) => {
    const norm = normHeader(raw);
    if (!norm) return;
    const field = ALIAS_INDEX.get(norm);
    if (field && !colToField.has(idx)) {
      if (!Object.prototype.hasOwnProperty.call(mapping, field)) {
        colToField.set(idx, field);
        mapping[field] = displayHeader(raw);
      } else {
        unmappedHeaders.push(displayHeader(raw));
      }
    } else {
      unmappedHeaders.push(displayHeader(raw));
    }
  });

  if (!mapping.carName) {
    throw new Error(
      "No column matched 'Car Name'. Expected one of: Car Name, Car, Vehicle, Name."
    );
  }

  const errors: { row: number; reason: string }[] = [];
  const newRows: BulkCar[] = [];
  let scanned = 0;

  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] as unknown[];
    if (!row || row.every((c) => c === undefined || c === null || c === "")) {
      continue;
    }
    scanned++;

    const get = (f: keyof Car): unknown => {
      for (const [idx, field] of colToField.entries()) {
        if (field === f) return row[idx];
      }
      return undefined;
    };

    const carName = String(get("carName") ?? "").trim();
    if (!carName) {
      errors.push({ row: r + 1, reason: "Missing car name" });
      continue;
    }

    const car: BulkCar = {
      id: String(get("id") ?? "").trim() || genId(),
      carName,
      model: String(get("model") ?? "").trim(),
      rentedTo: String(get("rentedTo") ?? "").trim(),
      dateRented: toIsoDate(get("dateRented")),
      rentedTill: toIsoDate(get("rentedTill")),
      rentedPrice: toNumber(get("rentedPrice")),
      advancePaid: toNumber(get("advancePaid")),
    };

    if (
      car.dateRented &&
      car.rentedTill &&
      new Date(car.rentedTill) < new Date(car.dateRented)
    ) {
      errors.push({
        row: r + 1,
        reason: "'Rented till' is earlier than 'Date rented'",
      });
      continue;
    }

    newRows.push(car);
  }

  // Deduplicate IDs within the imported batch.
  const seen = new Set<string>();
  const dedupedNew: BulkCar[] = [];
  for (const c of newRows) {
    if (seen.has(c.id)) c.id = genId();
    seen.add(c.id);
    dedupedNew.push(c);
  }

  let imported = 0;
  if (opts.mode === "replace") {
    imported = await replaceAllCars(dedupedNew);
  } else {
    // Avoid id collisions with existing rows.
    const existingIds = await getExistingIds();
    for (const c of dedupedNew) {
      if (existingIds.has(c.id)) c.id = genId();
      existingIds.add(c.id);
    }
    imported = await appendCars(dedupedNew);
  }

  return {
    imported,
    skipped: errors.length,
    totalRowsScanned: scanned,
    mapping,
    unmappedHeaders: Array.from(new Set(unmappedHeaders)).filter(Boolean),
    errors,
  };
}

// --------------------------------------------------------------------------
// Export — build a downloadable workbook from the current DB contents.
// --------------------------------------------------------------------------

export async function buildExportBuffer(): Promise<Buffer> {
  const cars = await getAllCars();
  const wb = XLSX.utils.book_new();
  const data: (string | number)[][] = [HEADERS as string[]];
  for (const r of cars) {
    data.push([
      r.id,
      r.carName,
      r.model,
      r.rentedTo,
      r.dateRented,
      r.rentedTill,
      Number(r.rentedPrice) || 0,
      Number(r.advancePaid) || 0,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [
    { wch: 14 },
    { wch: 22 },
    { wch: 18 },
    { wch: 22 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}
