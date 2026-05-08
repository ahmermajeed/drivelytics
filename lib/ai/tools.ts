import {
  addCar,
  deleteCars,
  extendRentalTill,
  fuzzyFindOne,
  getStats,
  listEnriched,
  markRentalReturned,
  recordPayment,
  updateCar,
} from "../cars";
import type { ToolDef } from "./types";

/**
 * Tool layer — the only surface the AI can use to interact with the business.
 *
 * Hard rules:
 *   1. The AI never touches the DB directly. Every mutation goes through here.
 *   2. Every tool returns a JSON-serializable result. We `JSON.stringify` it
 *      before sending back, so anything not stringifiable will crash loudly.
 *   3. Errors are returned as `{ ok: false, error: "..." }` rather than thrown
 *      — the model can read the error and decide what to do (retry / ask user).
 *   4. Each tool is idempotent or otherwise safe to retry, except for the
 *      explicit destructive ones (deleteRental).
 *
 * If you add a tool, also add an entry to `TOOL_DEFS` and `executeTool`.
 */

// --------------------------------------------------------------------------
// Tool schemas (sent to the model so it knows what's available)
// --------------------------------------------------------------------------

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "listRentals",
    description:
      "List rentals with optional filtering. Use this for any question about which cars are currently rented, expiring soon, overdue, or to find rentals matching a name.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["all", "active", "expiring", "overdue", "no_dates"],
          description:
            "Filter by status. 'expiring' = active and ending within `expiringWithinDays` days. Default 'all'.",
        },
        expiringWithinDays: {
          type: "integer",
          description:
            "Used only when status='expiring'. Default 7. Use 1 for 'tomorrow', 0 for 'today'.",
          minimum: 0,
          maximum: 365,
        },
        search: {
          type: "string",
          description:
            "Free text matched against car name, model, renter (rentedTo), and id. Case-insensitive.",
        },
        limit: {
          type: "integer",
          description: "Maximum rows to return. Default 50, hard cap 200.",
          minimum: 1,
          maximum: 200,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "getRental",
    description:
      "Look up one rental by id or by a fuzzy query (e.g. 'Civic', 'Ahmed'). Returns null if no match. Prefer this over listRentals when you only need a single record (e.g. before extending or recording a payment).",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Either an exact rental id (e.g. 'c_lx9k2abcd') or a fuzzy phrase matched against car name / model / renter.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "addRental",
    description:
      "Create a new rental. carName and model are required; everything else is optional. Dates must be YYYY-MM-DD. Confirm details with the user before calling unless they were unambiguous.",
    parameters: {
      type: "object",
      properties: {
        carName: { type: "string", description: "e.g. 'Toyota Corolla'." },
        model: { type: "string", description: "e.g. '2023 GLi'." },
        rentedTo: {
          type: "string",
          description: "Person or company name renting the car.",
        },
        dateRented: { type: "string", description: "ISO date YYYY-MM-DD." },
        rentedTill: { type: "string", description: "ISO date YYYY-MM-DD." },
        rentedPrice: {
          type: "number",
          description: "Total agreed price.",
          minimum: 0,
        },
        advancePaid: {
          type: "number",
          description: "Advance amount already paid.",
          minimum: 0,
        },
      },
      required: ["carName", "model"],
      additionalProperties: false,
    },
  },
  {
    name: "extendRental",
    description:
      "Push out the rentedTill date for an existing rental. Use this for 'extend X by N days' or 'change return date to ...' requests. Always confirm with the user before calling.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Exact rental id." },
        newRentedTill: {
          type: "string",
          description: "New end date as YYYY-MM-DD.",
        },
      },
      required: ["id", "newRentedTill"],
      additionalProperties: false,
    },
  },
  {
    name: "updateRental",
    description:
      "Update one or more fields on an existing rental. Use this for free-form edits like 'change the price to 300', 'rename to Honda Civic', 'set rentedTo to Ahmed', etc. Only fields you provide are changed; omitted fields are left alone. Confirm with the user before calling.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Exact rental id." },
        carName: { type: "string" },
        model: { type: "string" },
        rentedTo: {
          type: "string",
          description: "Renter name. Pass empty string to clear.",
        },
        dateRented: {
          type: "string",
          description: "ISO YYYY-MM-DD. Pass empty string to clear.",
        },
        rentedTill: {
          type: "string",
          description: "ISO YYYY-MM-DD. Pass empty string to clear.",
        },
        rentedPrice: { type: "number", minimum: 0 },
        advancePaid: { type: "number", minimum: 0 },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "markReturned",
    description:
      "Mark a rental as returned by setting rentedTill to today. Use when the user says 'X has been returned' or 'close out X'. Confirm with the user first.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Exact rental id." },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "recordPayment",
    description:
      "Add a payment amount to a rental's advancePaid. Use for 'X paid Y' or 'received Y from X'. Amounts must be non-negative. Confirm with the user first.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Exact rental id." },
        amount: {
          type: "number",
          description: "Amount paid (will be added to existing advancePaid).",
          minimum: 0,
        },
      },
      required: ["id", "amount"],
      additionalProperties: false,
    },
  },
  {
    name: "deleteRental",
    description:
      "Permanently delete one rental. DESTRUCTIVE — always confirm with the user (verbatim 'yes' or 'delete') before calling. Prefer markReturned when the user just means the rental ended.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Exact rental id." },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "getStats",
    description:
      "Summary numbers for the fleet: counts, revenue, outstanding, and period-bounded new rentals. Use for 'give me a summary', 'how was this month', etc.",
    parameters: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["today", "week", "month", "all"],
          description:
            "'today', 'week' (last 7 days), 'month' (last 30 days), or 'all' (lifetime). Default 'all'.",
        },
      },
      additionalProperties: false,
    },
  },
];

// --------------------------------------------------------------------------
// Dispatcher
// --------------------------------------------------------------------------

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };
type Result<T> = Ok<T> | Err;

function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}
function err(message: string): Err {
  return { ok: false, error: message };
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
}
function asInt(v: unknown): number | undefined {
  const n = asNumber(v);
  return n === undefined ? undefined : Math.trunc(n);
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<Result<unknown>> {
  try {
    switch (name) {
      case "listRentals": {
        const limit = Math.min(asInt(args.limit) ?? 50, 200);
        const rows = await listEnriched({
          status:
            (asString(args.status) as
              | "all"
              | "active"
              | "expiring"
              | "overdue"
              | "no_dates"
              | undefined) ?? "all",
          expiringWithinDays: asInt(args.expiringWithinDays),
          search: asString(args.search),
          limit,
        });
        return ok({
          count: rows.length,
          rentals: rows,
        });
      }

      case "getRental": {
        const query = asString(args.query);
        if (!query) return err("query is required");
        const row = await fuzzyFindOne(query);
        return ok(row);
      }

      case "addRental": {
        const carName = asString(args.carName);
        const model = asString(args.model);
        if (!carName || !carName.trim()) return err("carName is required");
        if (!model || !model.trim()) return err("model is required");
        const car = await addCar({
          carName,
          model,
          rentedTo: asString(args.rentedTo),
          dateRented: asString(args.dateRented),
          rentedTill: asString(args.rentedTill),
          rentedPrice: asNumber(args.rentedPrice) ?? 0,
          advancePaid: asNumber(args.advancePaid) ?? 0,
        });
        return ok(car);
      }

      case "extendRental": {
        const id = asString(args.id);
        const newRentedTill = asString(args.newRentedTill);
        if (!id) return err("id is required");
        if (!newRentedTill) return err("newRentedTill is required");
        const car = await extendRentalTill(id, newRentedTill);
        if (!car) return err(`No rental found with id '${id}'`);
        return ok(car);
      }

      case "updateRental": {
        const id = asString(args.id);
        if (!id) return err("id is required");

        // Build a patch from whichever fields the model actually provided.
        // `undefined` = leave alone; explicit empty string for date/text =
        // clear it (matches our REST API semantics).
        const patch: Record<string, unknown> = {};
        if (args.carName !== undefined) patch.carName = asString(args.carName);
        if (args.model !== undefined) patch.model = asString(args.model);
        if (args.rentedTo !== undefined) patch.rentedTo = asString(args.rentedTo);
        if (args.dateRented !== undefined) patch.dateRented = asString(args.dateRented);
        if (args.rentedTill !== undefined) patch.rentedTill = asString(args.rentedTill);
        if (args.rentedPrice !== undefined) {
          const v = asNumber(args.rentedPrice);
          if (v === undefined || v < 0)
            return err("rentedPrice must be a non-negative number");
          patch.rentedPrice = v;
        }
        if (args.advancePaid !== undefined) {
          const v = asNumber(args.advancePaid);
          if (v === undefined || v < 0)
            return err("advancePaid must be a non-negative number");
          patch.advancePaid = v;
        }
        if (Object.keys(patch).length === 0) {
          return err("Provide at least one field to update");
        }
        const car = await updateCar(id, patch);
        if (!car) return err(`No rental found with id '${id}'`);
        return ok(car);
      }

      case "markReturned": {
        const id = asString(args.id);
        if (!id) return err("id is required");
        const car = await markRentalReturned(id);
        if (!car) return err(`No rental found with id '${id}'`);
        return ok(car);
      }

      case "recordPayment": {
        const id = asString(args.id);
        const amount = asNumber(args.amount);
        if (!id) return err("id is required");
        if (amount === undefined) return err("amount is required");
        const car = await recordPayment(id, amount);
        if (!car) return err(`No rental found with id '${id}'`);
        return ok(car);
      }

      case "deleteRental": {
        const id = asString(args.id);
        if (!id) return err("id is required");
        const removed = await deleteCars([id]);
        if (removed === 0) return err(`No rental found with id '${id}'`);
        return ok({ id, removed });
      }

      case "getStats": {
        const period =
          (asString(args.period) as
            | "today"
            | "week"
            | "month"
            | "all"
            | undefined) ?? "all";
        const stats = await getStats({ period });
        return ok(stats);
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return err((e as Error).message || "Tool execution failed");
  }
}
