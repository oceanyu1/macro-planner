/**
 * Potassium estimates from the Canadian Nutrient File (CNF 2015, Health Canada,
 * Open Government Licence – Canada). The menu has no potassium, so each dish is
 * matched to one CNF food and estimated as
 *   mg per 100 g × serving grams ÷ 100   (1 mL ≈ 1 g)
 * Matches are keyed by dish name (dishes repeat across the menu cycle), cached in
 * `k_mapping`, and confirmed or changed on the Review screen. Always an estimate:
 * the UI shows it with "~" in the amber `text-est` colour.
 *
 * Pure: no DB. The table is built by scripts/build-cnf.mjs.
 */
import cnfRows from "@/data/cnf-potassium.json";
import { estimatePotassiumMg, servingGrams } from "./nutrition";

export type CnfFood = { code: number; name: string; group: number; mgPer100g: number };

let foods: CnfFood[] | null = null;
export function cnfFoods(): CnfFood[] {
  foods ??= (cnfRows as [number, string, number, number][]).map(([code, name, group, mgPer100g]) => ({
    code,
    name,
    group,
    mgPer100g,
  }));
  return foods;
}

export function cnfByCode(code: number): CnfFood | undefined {
  return cnfFoods().find((f) => f.code === code);
}

/* ---------- keys ---------- */

/** The k_mapping key for a dish: its display name, lower-cased, without portion noise. */
export function potassiumKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\((?:[^()]*\b(?:oz|ml|g|vol|slice|piece)\b[^()]*)\)/g, " ") // "(2 OZ VOL)", "(30 ML)"
    .replace(/\b(mto|ptn|res|ap|vng)\b/g, " ")
    .replace(/[^a-z0-9&,' ]+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[ ,]+|[ ,]+$/g, "");
}

/** First real ingredient: skips water, oil, salt and seasoning; drops "(…)" sub-lists. */
export function firstIngredient(ingredients: string | null): string | null {
  if (!ingredients) return null;
  const parts = ingredients
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/Contains:.*$/i, "")
    .split(/[,;]/)
    .map((s) => s.trim().replace(/[\s.:–-]+$/, "").toLowerCase())
    .filter(Boolean);
  return parts.find((p) => !/^(water|ice( cubes)?|salt|pepper|black pepper|oil|canola oil|olive oil|cooking spray|spice|seasoning|sugar)$/.test(p)) ?? null;
}

/* ---------- matching ---------- */

const STOP = new Set(
  "a an and or of with in on the style fresh random pieces piece slice slices sliced diced chopped medium large small house made scratch our assorted cut de based".split(" "),
);
const COOKING = /\b(cooked|boiled|roasted|baked|broiled|steamed|grilled|braised|stewed|stir-fried|pan-fried|scrambled|poached|hard-boiled|hard-cooked|simmered|sauteed|fried)\b/;
/** Uncooked/processed forms whose potassium per 100 g is far off a served portion. "dry heat" is a cooking method. */
const BAD = /\b(dry(?! heat)|dried|uncooked|dehydrated|powder|powdered|concentrate|flour|babyfood|freeze-dried|instant|unprepared|baking chocolate|cake mix)\b/;
/** "Potato, skin, baked" is just the skin (much higher in potassium than a served potato). */
const PART_ONLY = /, (skin|peel|seeds?|bran|germ|tops only)(,|$)/;
/** Organ meats and by-products: never what a dining hall serves as "chicken" or "beef". */
const BYPRODUCT = /\b(livers?|hearts?|kidneys?|tongues?|tripe|brains?|lungs?|gizzards?|giblets|feet|tails?|spleen|pancreas|thymus|suet|variety meats|by-products?)\b|, fat, (cooked|raw)/;
/** A different *form* of the food (juice of the fruit, extract of the vanilla…): penalised unless the dish says so. */
const FORM_WORDS = "juice peel extract syrup candies candy bar beverage sauce soup pie cake cookie bread dressing sandwich burger patty cereal battered breaded fried spread chips snack drink nectar puree butter yolk sausage pasta noodle candied shake topping pudding".split(" ");
/** CNF names that start with a category ("Grains, rice, …", "Fish, salmon, …"): the food is the next segment. */
const CATEGORY_HEADS = new Set("grain fish pasta cereal seed sweet bean spice soybean nut legume dessert".split(" "));
/** Colour variants (green tomato, white grapefruit) are rarely the default. Red is the default tomato/pepper. */
const COLOURS = new Set(["green", "yellow", "white", "orange", "purple"]);
/** Words that describe a food without changing it much: not counted as "extra" words. */
const NEUTRAL = new Set(
  "cooked boiled drained raw roasted baked broiled steamed grilled braised stewed poached scrambled hard sauteed simmered meat only lean regular enriched unenriched without salt ripe flesh skin all types varieties year round average heat dry chicken broiler grain long whole plain prepared".split(" ").map((w) => w.replace(/s$/, "")),
);
/** Adjectives in dish names that shouldn't earn the "head noun" bonus. */
const ADJ = new Set(
  "black white green red yellow orange grilled roasted baked fried creamy spicy sweet hot cold honey herb herbe provence asian deli vegan mini baby sour mixed medley glazed spiced sauteed steamed crispy classic garden market plant gluten".split(" "),
);
/** Menu words → the words CNF uses. */
const SYNONYMS: Record<string, string[]> = {
  penne: ["pasta", "macaroni"],
  fusilli: ["pasta", "macaroni"],
  rigatoni: ["pasta", "macaroni"],
  spaghetti: ["pasta"],
  linguine: ["pasta", "spaghetti"],
  macaroni: ["pasta"],
  green: ["snap"], // green beans are "Beans, snap" in CNF; only beans carry "snap"
  rotini: ["pasta", "macaroni"],
  shell: ["pasta", "macaroni"],
  berry: ["blueberry", "strawberry", "raspberry"],
  naan: ["bread"],
  loaf: ["bread"],
  blondie: ["brownie"],
  broth: ["soup"],
  sloppy: ["beef", "ground"],
  noodle: ["pasta", "noodle"],
  oatmeal: ["oat", "hot", "cereal"],
  basmati: ["white", "long"],
  jasmine: ["white", "long"],
  spring: ["lettuce", "green"],
  flatbread: ["bread", "pita"],
  toast: ["bread"],
  scone: ["biscuit"],
  dahl: ["lentil"],
  dal: ["lentil"],
  chana: ["chickpea"],
  edamame: ["soybean"],
  mandarin: ["tangerine"],
};
/** Dishes that are usually raw as served. A cooking word in the name overrides this. */
const RAW_OK = /\b(salad|lettuce|spring|cucumber|tomato|onion|pepper|olive|carrot|fruit|apple|orange|grapefruit|peach|pineapple|berries|blueberr|cilantro|seaweed|seeds|nuts|yogurt|cheese|hummus|pico|salsa|pickle|mango|mandarin)/;

/** Which CNF food groups suit a dish kind (see FOOD GROUP.csv). */
const KIND_GROUPS: Record<string, number[]> = {
  protein: [1, 5, 7, 13, 15, 16, 17],
  dairy: [1],
  vegetable: [11, 16],
  starch: [20, 11, 18, 8],
  fruit: [9],
  dessert: [18, 19],
  beverage: [14, 9],
  condiment: [6, 4, 2],
};

function stem(w: string): string {
  if (w === "yogourt") return "yogurt"; // CNF's spelling
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("oes")) return w.slice(0, -2);
  if (w.length > 4 && /(ch|sh|ss|x|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

/** Per-food token cache: tokenising 5,400 names on every call is the slow part. */
let tokenCache: { all: Set<string>; list: string[]; head: Set<string>; lower: string }[] | null = null;
function foodTokens() {
  tokenCache ??= cnfFoods().map((f) => {
    const lower = f.name.toLowerCase();
    const list = tokens(lower);
    const segs = lower.split(",").map((x) => x.trim());
    let head = tokens(segs[0]);
    if (head.length && head.every((t) => CATEGORY_HEADS.has(t)) && segs[1]) head = head.concat(tokens(segs[1]));
    return { all: new Set(list), list, head: new Set(head), lower };
  });
  return tokenCache;
}

export type Suggestion = CnfFood & { score: number };

/**
 * Below this score the best match is usually a different food entirely (blondie →
 * soy flour, salsa → taco salad), so automatic matching leaves potassium unknown.
 */
export const MIN_AUTO_SCORE = 2.5;

/**
 * Rank CNF foods for a dish. Name words count double; the first real ingredient
 * helps break ties ("Togarashi Chicken" → chicken breast). Prefers cooked forms,
 * the food group that fits `kind`, and shorter (more generic) CNF names.
 */
export function suggestCnf(
  dish: { name: string; ingredients?: string | null; kind?: string | null },
  limit = 5,
): Suggestion[] {
  const key = potassiumKey(dish.name);
  const first = firstIngredient(dish.ingredients ?? null) ?? "";
  const nameT = new Set(tokens(key));
  const ingT = new Set(tokens(first).filter((t) => !nameT.has(t)));
  const synT = new Set([...nameT, ...ingT].flatMap((t) => SYNONYMS[t] ?? []).filter((t) => !nameT.has(t) && !ingT.has(t)));
  if (!nameT.size && !ingT.size) return [];
  const query = new Set([...nameT, ...ingT, ...synT]);
  const nouns = new Set([...query].filter((t) => !ADJ.has(t)));
  const dishText = `${key} ${first}`;
  const kindRawOk = !dish.kind || ["vegetable", "fruit", "condiment", "dairy"].includes(dish.kind);
  const rawOk = kindRawOk && RAW_OK.test(dishText) && !COOKING.test(key);
  const groups = KIND_GROUPS[dish.kind ?? ""] ?? [];

  const scored: Suggestion[] = [];
  const all = cnfFoods();
  const toks = foodTokens();
  for (let i = 0; i < all.length; i++) {
    const f = all[i];
    const { all: fset, list: ft, head, lower } = toks[i];
    let score = 0;
    let hits = 0;
    for (const [set, weight] of [[nameT, 3], [ingT, 1.5], [synT, 1.5]] as const) {
      for (const t of set) {
        if (fset.has(t)) {
          score += weight;
          hits++;
        }
      }
    }
    if (!hits) continue;
    // The CNF food *is* this thing (+2), or it's something else that merely mentions it (−1.5).
    score += [...head].some((t) => nouns.has(t)) ? 2 : -1.5;
    if (COOKING.test(lower) && !/\bfried\b/.test(lower)) score += rawOk ? 0.2 : 1;
    if (/\braw\b/.test(lower)) score += rawOk ? 0.6 : -1;
    if (BAD.test(lower)) score -= 2.5;
    if (BYPRODUCT.test(lower)) score -= 4;
    if (PART_ONLY.test(lower) && !query.has("skin") && !query.has("seed")) score -= 3;
    for (const w of FORM_WORDS) if (fset.has(w) && !query.has(w) && !dishText.includes(w)) score -= 2;
    if (/\b(canned|frozen|with salt|salted|fast foods?|restaurant)\b/.test(lower)) score -= 0.5;
    if (groups.includes(f.group)) score += 1;
    // Every word the CNF name adds beyond the dish (and plain descriptors) makes it less likely.
    const extra = new Set(ft.filter((t) => !query.has(t) && !NEUTRAL.has(t)));
    score -= extra.size * 0.35;
    for (const c of COLOURS) if (extra.has(c)) score -= 0.3;
    scored.push({ ...f, score: Math.round(score * 100) / 100 });
  }
  return scored.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.code - b.code).slice(0, limit);
}

/**
 * Hand-checked matches for dishes the scorer gets wrong (reviewed 2026-11-25 against
 * the full Teraanga menu). Key = potassiumKey(dish name); value = CNF food code.
 * These win over the scorer. Add to this list rather than editing k_mapping by hand.
 */
export const KNOWN_MATCHES: Record<string, number> = {
  // brownies and blondies: the scorer finds baking chocolate, soy flour or rice mixes
  brownie: 3807,
  blondie: 3807,
  "salted caramel brownie": 3807,
  "chocolate, caramel pretzel brownie": 3807,
  "orange chocolate brownie": 3807,
  "pumpkin spice no gluten blondie": 3807,
  tiramisu: 3787, // sponge cake
  "chocolate fudge": 4168,
  "lemon fudge": 4171, // vanilla fudge
  "chocolate loaf": 3759, // chocolate cake
  "lemon poppy seed loaf": 3777, // pound cake (not "Spices, poppy seed")
  "cranberry scone": 3685, // biscuit (not cranberry beans)
  "rice krispie square": 4887,
  "confetti rice krispie square": 4887,
  "chocolate chip rice krispie square": 4887,
  salsa: 1025,
  "grilled naan": 6606,
  "cilantro lime rice": 4523, // white rice (not wild)
  "tomato & feta baked pasta": 4507,
  "plant based sausage rapini shells": 4507, // pasta shells (not taco shells)
  "market mixed greens": 6616, // spring mix
  cantaloupe: 1721,
  guacamole: 1511, // avocado
  bacon: 5405, // pork bacon (not turkey bacon)
  "peameal bacon": 1859, // back bacon, grilled
  "bacon cheeseburger pizza": 7130, // the dish is pizza, not bacon
  "spinach white pizza": 7130,
  // frittatas are mostly egg
  "mushroom & spinach frittata": 133,
  "spinach potato plant based frittata": 133,
  "caponata plant based frittata": 133,
  "plant based mediterranean frittata": 133,
  "western tofu frittata": 133,
};

/**
 * The match used when nobody has confirmed one: a hand-checked match if there is
 * one, else the scorer's best if it's confident enough, else null (unknown).
 */
export function autoMatch(dish: { name: string; ingredients?: string | null; kind?: string | null }): CnfFood | null {
  const known = KNOWN_MATCHES[potassiumKey(dish.name)];
  if (known != null) return cnfByCode(known) ?? null;
  const best = suggestCnf(dish, 1)[0];
  return best && best.score >= MIN_AUTO_SCORE ? best : null;
}

/** Free-text search for the Review screen. */
export function searchCnf(q: string, limit = 12): CnfFood[] {
  const qt = tokens(q);
  if (!qt.length) return [];
  return cnfFoods()
    .map((f) => {
      const ft = new Set(tokens(f.name));
      const hits = qt.filter((t) => ft.has(t)).length;
      return { f, hits };
    })
    .filter((x) => x.hits === qt.length)
    .sort((a, b) => a.f.name.length - b.f.name.length || a.f.code - b.f.code)
    .slice(0, limit)
    .map((x) => x.f);
}

/** Estimated potassium for one serving, or null when the serving has no weight ("1 each"). */
export function servingPotassium(
  mgPer100g: number | null,
  servingAmount: number | null,
  servingUnit: string | null,
): number | null {
  if (mgPer100g == null) return null;
  const g = servingGrams(servingAmount, servingUnit);
  return g == null ? null : estimatePotassiumMg(mgPer100g, g);
}
