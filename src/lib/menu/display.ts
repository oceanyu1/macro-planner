/**
 * Display-only clean-up for menu text. The stored names and serving strings
 * stay exactly as MyDiningHub sends them (they key the potassium matches).
 */

/**
 * "MTO PTN YOGURT, GREEK, PLAIN (2 OZ VOL)" → "Yogurt, Greek, Plain".
 * Drops the made-to-order prefix and a trailing portion note, and title-cases
 * names that arrive in all caps. Normal names ("Creamy Scrambled Egg") pass through.
 */
export function dishName(name: string): string {
  let s = name
    .trim()
    .replace(/^MTO\s+(PTN\s+)?/i, "")
    .replace(/\s*\((?=[^()]*\b(?:oz|ml|g|vol|slice|piece|each|cup)\b)[^()]*\)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length > 1 && letters === letters.toUpperCase()) {
    s = s.toLowerCase().replace(/(^|[\s,(/&-])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
  }
  return s || name;
}

const UNITS: [RegExp, string][] = [
  [/\bmillilit(?:re|er)s?\b/i, "mL"],
  [/\bkilograms?\b/i, "kg"],
  [/\bgrams?\b/i, "g"],
  [/\bteaspoons?\b/i, "tsp"],
  [/\btablespoons?\b/i, "tbsp"],
  [/\bounces?\b/i, "oz"],
];

/** "118 millilitre" → "118 mL", "155 gram" → "155 g". Pieces and slices stay words. */
export function servingLabel(serving: string): string {
  let s = serving.trim();
  for (const [re, short] of UNITS) s = s.replace(re, short);
  return s;
}
