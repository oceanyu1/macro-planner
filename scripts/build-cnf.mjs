// Build src/data/cnf-potassium.json from the Canadian Nutrient File (CNF 2015) CSVs.
//
// Source: Health Canada, Canadian Nutrient File 2015, Open Government Licence – Canada.
//   https://www.canada.ca/en/health-canada/services/food-nutrition/healthy-eating/nutrient-data.html
//   Zip: https://www.canada.ca/content/dam/hc-sc/migration/hc-sc/fn-an/alt_formats/zip/nutrition/fiche-nutri-data/cnf-fcen-csv.zip
//
// Usage: unzip the CSVs somewhere outside the repo, then
//   node scripts/build-cnf.mjs <dir with "FOOD NAME.csv" etc.>
// Output rows: [foodCode, description, foodGroupId, potassium mg per 100 g]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/build-cnf.mjs <cnf csv dir>");
  process.exit(1);
}

const POTASSIUM = "306";
const SKIP_GROUPS = new Set(["3"]); // babyfoods

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, newlines in quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const read = (f) => parseCsv(readFileSync(path.join(dir, f), "latin1"));
const table = (f) => {
  const [head, ...rows] = read(f);
  return rows.filter((r) => r.length >= head.length - 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
};

const k = new Map();
for (const r of table("NUTRIENT AMOUNT.csv")) if (r.NutrientID === POTASSIUM) k.set(r.FoodID, Number(r.NutrientValue));

const out = [];
for (const f of table("FOOD NAME.csv")) {
  if (SKIP_GROUPS.has(f.FoodGroupID) || !k.has(f.FoodID)) continue;
  const mg = k.get(f.FoodID);
  if (!Number.isFinite(mg)) continue;
  out.push([Number(f.FoodCode), f.FoodDescription.trim(), Number(f.FoodGroupID), Math.round(mg)]);
}
out.sort((a, b) => a[0] - b[0]);

const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/data/cnf-potassium.json");
mkdirSync(path.dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out).replace(/\],\[/g, "],\n["));
console.log(`wrote ${out.length} foods to ${dest}`);
