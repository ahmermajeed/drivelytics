// Generates sample input files in <project>/scripts/samples/ for the import smoke test.
// Uses headers that DON'T exactly match our schema, so the smart mapping is exercised.
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const dir = path.join(__dirname, "samples");
fs.mkdirSync(dir, { recursive: true });

// Note the deliberately varied header names to test the alias map.
const aoa = [
  ["Vehicle", "Variant", "From", "To", "Price", "Deposit"],
  ["BMW 3 Series", "330i M-Sport", "2026-06-01", "2026-06-10", 1200, 400],
  ["Audi A4", "Premium Plus", "2026-06-03", "2026-06-09", 980, 300],
  ["Hyundai Sonata", "N-Line", "2026-06-05", "2026-06-12", 540, 200],
];

// xlsx
{
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, "Rentals");
  XLSX.writeFile(wb, path.join(dir, "sample.xlsx"));
}

// xls (BIFF8)
{
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, "Rentals");
  XLSX.writeFile(wb, path.join(dir, "sample.xls"), { bookType: "biff8" });
}

// csv
{
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, "Rentals");
  XLSX.writeFile(wb, path.join(dir, "sample.csv"), { bookType: "csv" });
}

console.log("Wrote samples to", dir);
