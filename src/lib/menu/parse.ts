/**
 * Pure parser for MyDiningHub's getLocationRecipes response (one date × one meal).
 * No I/O here, so it is tested against the saved fixtures.
 *
 * Shape (see AGENTS.md "Menu API"):
 *  - locationRecipesMap.dateSkuMap[].stations[] → station id + SKUs served there.
 *    `simple` SKUs are products; `configurable` SKUs are a parent product plus the
 *    variant SKUs (serving sizes) actually served.
 *  - products.items[] → name/sku/attributes. Simple items carry nutrition as string
 *    attributes. Configurable items carry each variant's nutrition in the JSON-string
 *    attribute `configurable_option_attributes`, keyed by option id, and
 *    `options[0].values[]` maps that option id to the serving title ("85 millilitre").
 */
import { parseServingSize, servingGrams } from "@/lib/nutrition";
import { STATIONS } from "./api";
import { classifyKind, type ItemKind } from "./kind";

export type ParsedMenuItem = {
  /** MyDiningHub recipe id, e.g. "M74556". Stable across menu cycles, unlike the SKU prefix. */
  sourceId: string;
  sku: string;
  name: string;
  station: string | null;
  kind: ItemKind;
  servingSize: string;
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
  allergens: string[];
};

export type ParseResult = {
  items: ParsedMenuItem[];
  /** Served SKUs we dropped, and why (bulk batch sizes, impossible nutrition, missing data). */
  skipped: { sku: string; name: string; reason: string }[];
};

type Attr = { name: string; value: unknown };
type Product = {
  name: string;
  sku: string;
  attributes?: Attr[];
  options?: { title?: string; values?: { id: string; title: string }[] }[];
};
type Station = {
  id: number;
  skus: { simple?: string[]; configurable?: { sku: string; variants?: string[] }[] };
};
type Response = {
  data?: {
    getLocationRecipes?: {
      locationRecipesMap?: { dateSkuMap?: { date: string; stations?: Station[] }[] };
      products?: { items?: Product[] };
    } | null;
  } | null;
  errors?: { message: string }[];
};

/** Variant nutrition object inside `configurable_option_attributes`. */
type VariantAttrs = Record<string, unknown> & { sku: string };

export class MenuResponseError extends Error {}

export function parseLocationRecipes(json: unknown, date: string): ParseResult {
  const res = json as Response;
  if (res?.errors?.length) throw new MenuResponseError(`GraphQL: ${res.errors.map((e) => e.message).join("; ")}`);
  const root = res?.data?.getLocationRecipes;
  if (!root) throw new MenuResponseError("response has no data.getLocationRecipes");

  const day = root.locationRecipesMap?.dateSkuMap?.find((d) => d.date === date);
  const products = new Map((root.products?.items ?? []).map((p) => [p.sku, p]));
  const out: ParseResult = { items: [], skipped: [] };
  if (!day) return out;

  const seen = new Set<string>();
  const add = (item: ParsedMenuItem | string, sku: string, name: string) => {
    if (typeof item === "string") {
      out.skipped.push({ sku, name, reason: item });
      return;
    }
    // The same dish can be listed at two stations; keep the first.
    const key = `${item.sourceId}|${item.servingSize}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.items.push(item);
  };

  for (const st of day.stations ?? []) {
    const station = STATIONS[st.id] ?? `Station ${st.id}`;

    for (const sku of st.skus.simple ?? []) {
      const p = products.get(sku);
      if (!p) {
        out.skipped.push({ sku, name: "?", reason: "not in products" });
        continue;
      }
      const a = attrMap(p.attributes);
      add(fromSimple(p, a, station), sku, displayName(p, a));
    }

    for (const cfg of st.skus.configurable ?? []) {
      const p = products.get(cfg.sku);
      if (!p) {
        out.skipped.push({ sku: cfg.sku, name: "?", reason: "not in products" });
        continue;
      }
      const a = attrMap(p.attributes);
      const variants = parseVariants(a.configurable_option_attributes);
      const titles = new Map((p.options?.[0]?.values ?? []).map((v) => [v.id, v.title]));
      const bySku = new Map(Object.entries(variants).map(([optionId, v]) => [v.sku, { optionId, v }]));
      for (const vsku of cfg.variants ?? []) {
        const hit = bySku.get(vsku);
        const name = displayName(p, a);
        if (!hit) {
          out.skipped.push({ sku: vsku, name, reason: "variant has no nutrition" });
          continue;
        }
        add(fromVariant(p, a, hit.v, titles.get(hit.optionId) ?? null, station), vsku, name);
      }
    }
  }
  return out;
}

/* ---------- builders ---------- */

function fromSimple(p: Product, a: Record<string, unknown>, station: string): ParsedMenuItem | string {
  if (yes(a.is_bulk)) return "bulk batch size";
  if (yes(a.is_hide_from_web_menu)) return "hidden from web menu";
  const serving = str(a.serving_combined) ?? combineServing(a);
  if (!serving) return "no serving size";
  return build(p, a, a, serving, station);
}

function fromVariant(
  p: Product,
  a: Record<string, unknown>,
  v: VariantAttrs,
  servingTitle: string | null,
  station: string,
): ParsedMenuItem | string {
  if (yes(v.is_bulk)) return "bulk batch size";
  if (yes(v.is_hide_from_web_menu)) return "hidden from web menu";
  if (!servingTitle) return "variant has no serving title";
  return build(p, a, v, servingTitle, station, v.sku);
}

function build(
  p: Product,
  a: Record<string, unknown>,
  n: Record<string, unknown>,
  serving: string,
  station: string,
  sku = p.sku,
): ParsedMenuItem | string {
  const sourceId = str(a.recipe_id) ?? p.sku.split("_")[2];
  if (!sourceId) return "no recipe id";
  const name = displayName(p, a);
  const { amount, unit } = parseServingSize(serving);
  const calories = int(n.calories);

  // Source data sometimes has impossible values (a 25 g muffin at 1,344 kcal). Fat is 9 kcal/g.
  const grams = servingGrams(amount, unit);
  if (calories != null && grams && calories / grams > 9.5) return "impossible calories for serving size";

  return {
    sourceId,
    sku,
    name,
    station,
    kind: classifyKind(str(a.master_recipe_type), p.name),
    servingSize: serving,
    servingAmount: amount,
    servingUnit: unit,
    calories,
    fatG: dec(n.total_fat),
    satFatG: dec(n.saturated_fat),
    transFatG: dec(n.trans_fat),
    cholesterolMg: int(n.cholesterol),
    sodiumMg: int(n.sodium),
    carbsG: dec(n.total_carbohydrates),
    fiberG: dec(n.dietary_fiber),
    sugarsG: dec(n.sugars),
    proteinG: dec(n.protein),
    ingredients: str(n.recipe_ingredients) ?? str(a.recipe_ingredients),
    allergens: parseAllergens(str(n.allergen_statement) ?? str(a.allergen_statement)),
  };
}

/* ---------- field helpers ---------- */

function attrMap(attrs: Attr[] | undefined): Record<string, unknown> {
  return Object.fromEntries((attrs ?? []).map((x) => [x.name, x.value]));
}

function parseVariants(raw: unknown): Record<string, VariantAttrs> {
  if (typeof raw !== "string") return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, VariantAttrs>) : {};
  } catch {
    return {};
  }
}

/** "Herbes de Provence Salmon" (marketing name) over "FISH, SALMON, BAKED, HERBES DE PROVENCE RES". */
function displayName(p: Product, a: Record<string, unknown>): string {
  return (str(a.marketing_name) ?? p.name).replace(/\s+/g, " ").trim();
}

/** serving_size "N/A" + serving_fraction "1/2" + unit "teaspoon" → "1/2 teaspoon" */
function combineServing(a: Record<string, unknown>): string | null {
  const size = str(a.serving_size);
  const frac = str(a.serving_fraction);
  const unit = str(a.serving_unit);
  const qty = size ?? frac;
  return qty && unit ? `${qty} ${unit}` : null;
}

/** "Contains: Fish, Milk" → ["Fish", "Milk"]; anything else (e.g. "not available") → []. */
export function parseAllergens(s: string | null): string[] {
  const m = s?.match(/^Contains:\s*(.*)$/i);
  if (!m) return [];
  return m[1]
    .split(/[,;]/)
    .map((x) => x.trim().replace(/\.$/, ""))
    .filter(Boolean);
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.toUpperCase() !== "N/A" ? t : null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

const int = (v: unknown) => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};

const dec = (v: unknown) => {
  const n = num(v);
  return n == null ? null : Math.round(n * 10) / 10;
};

const yes = (v: unknown) => v === "yes" || v === "1" || v === 1 || v === true;
