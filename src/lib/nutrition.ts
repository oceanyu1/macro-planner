/**
 * Nutrition helpers shared by the menu ingest, the planner and the food log.
 * Protein, sodium and calories come straight off the label; potassium is
 * always an estimate unless it came from the CNF for a whole food.
 */

export type Panel = {
  servingSize: string | null;
  servingAmount: number | null;
  servingUnit: string | null;
  calories: number | null;
  fatG: number | null;
  satFatG: number | null;
  transFatG: number | null;
  cholesterolMg: number | null;
  sodiumMg: number | null;
  carbsG: number | null;
  fiberG: number | null;
  sugarsG: number | null;
  proteinG: number | null;
  ingredients: string | null;
};

const LABELS: Record<string, keyof Panel> = {
  "serving size": "servingSize",
  calories: "calories",
  "total fat": "fatG",
  "saturated fat": "satFatG",
  "trans fat": "transFatG",
  cholesterol: "cholesterolMg",
  sodium: "sodiumMg",
  "total carbohydrates": "carbsG",
  "total carbohydrate": "carbsG",
  "dietary fiber": "fiberG",
  "dietary fibre": "fiberG",
  "total sugars": "sugarsG",
  sugars: "sugarsG",
  protein: "proteinG",
  ingredients: "ingredients",
};

const UNIT_ALIASES: Record<string, string> = {
  g: "g",
  gram: "g",
  grams: "g",
  gm: "g",
  ml: "ml",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  "fl oz": "floz",
  cup: "cup",
  cups: "cup",
  each: "each",
  piece: "each",
  pieces: "each",
  slice: "each",
  slices: "each",
  serving: "each",
};

/** "100 gram" → { amount: 100, unit: "g" }; "1/2 cup" → { 0.5, "cup" } */
export function parseServingSize(s: string): { amount: number | null; unit: string | null } {
  const m = s.trim().toLowerCase().match(/^(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?|\d+\s+\d+\/\d+)\s*(.*)$/);
  if (!m) return { amount: null, unit: null };
  const amount = parseAmount(m[1]);
  const rawUnit = m[2].replace(/[().]/g, "").trim();
  const unit = UNIT_ALIASES[rawUnit] ?? (rawUnit || null);
  return { amount, unit };
}

function parseAmount(s: string): number | null {
  const t = s.trim();
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** "540 mg" → 540, "2.5 g" → 2.5, "<1 g" → 0.5, "-" → null */
function parseQuantity(s: string): number | null {
  const t = s.trim().toLowerCase();
  const lt = t.match(/^<\s*(\d+(?:\.\d+)?)/);
  if (lt) return Number(lt[1]) / 2;
  const m = t.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/**
 * Parse the nutrition panel as text, in the layout the dining-hall site shows
 * (label on one line, value on the next) or as "Label 540 mg" on one line.
 */
export function parseNutritionPanel(text: string): Panel {
  const out: Panel = {
    servingSize: null,
    servingAmount: null,
    servingUnit: null,
    calories: null,
    fatG: null,
    satFatG: null,
    transFatG: null,
    cholesterolMg: null,
    sodiumMg: null,
    carbsG: null,
    fiberG: null,
    sugarsG: null,
    proteinG: null,
    ingredients: null,
  };
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const labelKeys = Object.keys(LABELS).sort((a, b) => b.length - a.length);

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase().replace(/:$/, "");
    const label = labelKeys.find((k) => lower === k || lower.startsWith(k + " ") || lower.startsWith(k + ":"));
    if (!label) continue;
    const key = LABELS[label];
    if (out[key] !== null) continue; // first occurrence wins ("Sugars" inside "Total Sugars" etc.)

    let value = lines[i].slice(label.length).replace(/^[:\s]+/, "");
    if (!value && i + 1 < lines.length) {
      value = lines[i + 1];
      i++;
    }
    if (!value) continue;

    if (key === "servingSize") {
      out.servingSize = value;
      const { amount, unit } = parseServingSize(value);
      out.servingAmount = amount;
      out.servingUnit = unit;
    } else if (key === "ingredients") {
      out.ingredients = value;
    } else {
      (out[key] as number | null) = parseQuantity(value);
    }
  }
  return out;
}

/** First N ingredients, lower-cased, without parenthetical sub-ingredients. */
export function mainIngredients(ingredients: string | null, n = 2): string[] {
  if (!ingredients) return [];
  const flat = ingredients.replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "");
  return flat
    .split(/[,;]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, n);
}

const GRAMS_PER: Record<string, number> = {
  g: 1,
  ml: 1, // rough: 1 mL ≈ 1 g, per the design plan
  oz: 28.35,
  floz: 29.57,
  cup: 240,
};

/** Serving weight in grams, or null when the unit has no fixed weight ("each"). */
export function servingGrams(amount: number | null, unit: string | null): number | null {
  if (amount == null || unit == null) return null;
  const per = GRAMS_PER[unit];
  return per == null ? null : amount * per;
}

/** Potassium estimate = mg per 100 g × serving grams ÷ 100. */
export function estimatePotassiumMg(mgPer100g: number, grams: number): number {
  return Math.round((mgPer100g * grams) / 100);
}

export type NutrientRow = {
  proteinG: number;
  sodiumMg: number;
  potassiumMg: number;
  calories: number;
};

export function sumNutrients(rows: NutrientRow[]): NutrientRow {
  return rows.reduce(
    (acc, r) => ({
      proteinG: acc.proteinG + r.proteinG,
      sodiumMg: acc.sodiumMg + r.sodiumMg,
      potassiumMg: acc.potassiumMg + r.potassiumMg,
      calories: acc.calories + r.calories,
    }),
    { proteinG: 0, sodiumMg: 0, potassiumMg: 0, calories: 0 },
  );
}

/** Molar-free, mass-based K:Na ratio (mg/mg), the way most trackers show it. */
export function kNaRatio(potassiumMg: number, sodiumMg: number): number | null {
  if (sodiumMg <= 0) return null;
  return Math.round((potassiumMg / sodiumMg) * 100) / 100;
}
