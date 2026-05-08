import fs from "node:fs";
import path from "node:path";
import { importFromBuffer } from "../lib/xlsx-io";
import { prisma } from "../lib/prisma";

/**
 * One-shot migration helper: if the legacy `data/cars.xlsx` file exists and
 * the DB is empty, import its rows so we don't lose pre-Postgres data.
 *
 * This is safe to re-run — it's a no-op once any rows exist.
 *
 * Run with: `npx prisma db seed`  (or `npm run db:seed`)
 */
async function main() {
  const existing = await prisma.car.count();
  if (existing > 0) {
    console.log(`[seed] Skipped — DB already has ${existing} car(s).`);
    return;
  }

  const xlsxPath = path.join(process.cwd(), "data", "cars.xlsx");
  if (!fs.existsSync(xlsxPath)) {
    console.log("[seed] No legacy data/cars.xlsx found. Starting fresh.");
    return;
  }

  console.log(`[seed] Importing legacy rows from ${xlsxPath} ...`);
  const buf = fs.readFileSync(xlsxPath);
  const report = await importFromBuffer(buf, "cars.xlsx", { mode: "append" });
  console.log(
    `[seed] Imported ${report.imported} row(s), skipped ${report.skipped}, scanned ${report.totalRowsScanned}.`
  );
  if (report.errors.length) {
    console.log(`[seed] Errors:`, report.errors);
  }
}

main()
  .catch((e) => {
    console.error("[seed] Failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
