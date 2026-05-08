import { NextResponse } from "next/server";
import { addCar, deleteCars, getAllCars, updateCar } from "@/lib/cars";
import type { Car } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message: string, status = 400, cause?: unknown) {
  if (status >= 500) console.error("[api/cars]", message, cause ?? "");
  return NextResponse.json({ ok: false, error: message }, { status });
}

function validate(input: Partial<Car>): string | null {
  if (!input.carName || !String(input.carName).trim()) return "Car name is required";
  if (!input.model || !String(input.model).trim()) return "Model is required";
  if (input.dateRented && input.rentedTill) {
    if (new Date(input.rentedTill) < new Date(input.dateRented)) {
      return "'Rented till' must be on or after 'Date rented'";
    }
  }
  if (input.rentedPrice !== undefined && Number(input.rentedPrice) < 0)
    return "Rented price cannot be negative";
  if (input.advancePaid !== undefined && Number(input.advancePaid) < 0)
    return "Advance paid cannot be negative";
  return null;
}

export async function GET() {
  try {
    const cars = await getAllCars();
    return NextResponse.json({ ok: true, data: cars });
  } catch (e) {
    return bad((e as Error).message, 500, e);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<Car>;
    const err = validate(body);
    if (err) return bad(err);
    const car = await addCar({
      carName: body.carName!,
      model: body.model!,
      dateRented: body.dateRented ?? "",
      rentedTill: body.rentedTill ?? "",
      rentedPrice: Number(body.rentedPrice) || 0,
      advancePaid: Number(body.advancePaid) || 0,
    });
    return NextResponse.json({ ok: true, data: car }, { status: 201 });
  } catch (e) {
    return bad((e as Error).message, 500, e);
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as Partial<Car> & { id?: string };
    if (!body.id) return bad("Missing id");
    const err = validate(body);
    if (err) return bad(err);
    const updated = await updateCar(body.id, body);
    if (!updated) return bad("Car not found", 404);
    return NextResponse.json({ ok: true, data: updated });
  } catch (e) {
    return bad((e as Error).message, 500, e);
  }
}

export async function DELETE(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0)
      return bad("Provide an 'ids' array");
    const removed = await deleteCars(body.ids);
    return NextResponse.json({ ok: true, data: { removed } });
  } catch (e) {
    return bad((e as Error).message, 500, e);
  }
}
