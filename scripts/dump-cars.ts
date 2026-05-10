import { PrismaClient } from "@prisma/client";

async function main() {
  const p = new PrismaClient();
  const rows = await p.car.findMany({ orderBy: { createdAt: "asc" } });
  console.log(
    JSON.stringify(
      rows.map((r) => ({
        id: r.id,
        carName: r.carName,
        model: r.model,
        rentedTo: r.rentedTo,
        dateRented: r.dateRented?.toISOString().slice(0, 10) ?? null,
        rentedTill: r.rentedTill?.toISOString().slice(0, 10) ?? null,
        rentedPrice: r.rentedPrice,
      })),
      null,
      2,
    ),
  );
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
