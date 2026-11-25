/**
 * Planner v1 ("greedy"): pure, deterministic, no LLM. It is the permanent fallback.
 *
 * Per meal:
 *  1. Drop blocked foods (name or ingredients), desserts and anything rejected.
 *  2. Protein: try every combination of up to 2 protein dishes × 1–2 servings
 *     (× each serving size) and keep the one that best reaches the meal's protein
 *     share without blowing its calorie/sodium budget. Score favours protein per
 *     kcal and penalises sodium per gram of protein.
 *  3. Sides: a vegetable at lunch and dinner, then a starch if calories allow.
 * Per day:
 *  4. Over the sodium cap → re-plan the worst meal with sodium weighted harder,
 *     then drop starches.
 *  5. Calories outside target ± tolerance → add or trim starch servings.
 * Meals with something already eaten from the plan are "fixed" and kept as is.
 *
 * Budgets: each meal gets its protein-split share of the calorie target and the
 * sodium cap; the snack share is reserved for food you bring yourself.
 */
import type { ProteinSplit, Totals } from "@/db/schema";
import { servingGrams } from "./nutrition";

export type PlanMeal = "breakfast" | "lunch" | "dinner";
export const PLAN_MEALS: PlanMeal[] = ["breakfast", "lunch", "dinner"];

export type Candidate = {
  id: number;
  sourceId: string;
  name: string;
  station: string | null;
  kind: string | null;
  servingSize: string;
  servingAmount: number | null;
  servingUnit: string | null;
  calories: number | null;
  proteinG: number | null;
  sodiumMg: number | null;
  kMgEst: number | null;
  ingredients: string | null;
};

export type Role = "protein" | "vegetable" | "starch";
export type Pick = { item: Candidate; servings: number; role: Role };
export type MealTarget = { proteinG: number; calories: number; sodiumMg: number };
export type MealPlan = { meal: PlanMeal; picks: Pick[]; totals: Totals; target: MealTarget; fixed: boolean; notes: string[] };
export type DayPlan = { meals: Record<PlanMeal, MealPlan>; totals: Totals; budget: DayBudget; warnings: string[] };
export type DayBudget = { proteinG: number; caloriesMin: number; caloriesMax: number; sodiumMg: number };

export type PlannerSettings = {
  proteinTargetG: number;
  calorieTarget: number;
  calorieTolerance: number;
  sodiumCapMg: number;
  proteinSplit: ProteinSplit;
  blockedFoods: string[];
  preferredStations: string[];
};

export type PlanInput = {
  settings: PlannerSettings;
  /** What's served at each meal. */
  menu: Record<PlanMeal, Candidate[]>;
  /** Dish source ids rejected per meal (✕ in the UI). */
  rejected?: Partial<Record<PlanMeal, string[]>>;
  /** Meals already (partly) eaten: keep these picks exactly. */
  fixed?: Partial<Record<PlanMeal, Pick[]>>;
};

/** Plan 5–10 g above target as a buffer (design plan). */
export const PROTEIN_BUFFER_G = 6;
const MAX_SERVINGS = 2;
const MAX_PROTEIN_DISHES = 2;

/* ---------- budgets ---------- */

export function mealTargets(s: PlannerSettings): { meals: Record<PlanMeal, MealTarget>; day: DayBudget } {
  const split = s.proteinSplit;
  const mealSum = PLAN_MEALS.reduce((a, m) => a + (split[m] ?? 0), 0) || 1;
  const allSum = mealSum + (split.snack ?? 0);
  const share = (m: PlanMeal) => (split[m] ?? 0) / allSum;
  const mealsShare = mealSum / allSum;
  const meals = Object.fromEntries(
    PLAN_MEALS.map((m) => [
      m,
      {
        proteinG: (split[m] ?? 0) + (PROTEIN_BUFFER_G * (split[m] ?? 0)) / mealSum,
        calories: s.calorieTarget * share(m),
        sodiumMg: s.sodiumCapMg * share(m),
      },
    ]),
  ) as Record<PlanMeal, MealTarget>;
  return {
    meals,
    day: {
      proteinG: mealSum,
      caloriesMin: (s.calorieTarget - s.calorieTolerance) * mealsShare,
      caloriesMax: (s.calorieTarget + s.calorieTolerance) * mealsShare,
      sodiumMg: s.sodiumCapMg * mealsShare,
    },
  };
}

/* ---------- filters ---------- */

/**
 * Menu ingredients rarely say "pork": they say "Peameal bacon", "Toupie ham",
 * "Pepperoni". A blocked word also blocks its aliases, unless the dish name says
 * it's a non-pork version ("Turkey Bacon", "Plant Based Sausage").
 */
const BLOCK_ALIASES: Record<string, { aliases: string[]; unless: RegExp }> = {
  pork: {
    aliases: ["bacon", "ham", "pepperoni", "chorizo", "sausage", "salami", "prosciutto", "pancetta", "peameal", "chasu", "char siu", "lard", "carnitas", "kielbasa", "bratwurst", "capicola", "guanciale", "mortadella", "pulled pork"],
    unless: /\b(plant[- ]based|vegan|vegetarian|turkey|chicken|beef|halal)\b/i,
  },
};

const wordRe = (words: string[]) =>
  new RegExp(`\\b(${words.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})s?\\b`, "i");

function blockedMatcher(words: string[]): ((c: Candidate) => boolean) | null {
  const w = words.map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!w.length) return null;
  const direct = wordRe(w);
  const aliased = w.filter((x) => BLOCK_ALIASES[x]).map((x) => ({ re: wordRe(BLOCK_ALIASES[x].aliases), unless: BLOCK_ALIASES[x].unless }));
  return (c) => {
    const text = `${c.name} ${c.ingredients ?? ""}`;
    if (direct.test(text)) return true;
    return aliased.some((a) => a.re.test(text) && !a.unless.test(c.name));
  };
}

export function isBlocked(c: Candidate, words: string[]): boolean {
  return blockedMatcher(words)?.(c) ?? false;
}

const known = (c: Candidate) => c.calories != null && c.proteinG != null && c.sodiumMg != null;
const P = (c: Candidate) => c.proteinG ?? 0;
const K = (c: Candidate) => c.calories ?? 0;
const NA = (c: Candidate) => c.sodiumMg ?? 0;
const grams = (c: Candidate) => servingGrams(c.servingAmount, c.servingUnit);

function isProteinSource(c: Candidate) {
  // ≥ 5 g protein per 100 kcal: scrambled eggs (5.7) count, baked beans (4.4) don't.
  return (c.kind === "protein" || c.kind === "dairy") && P(c) >= 5 && K(c) > 0 && (P(c) * 100) / K(c) >= 5;
}

/* ---------- totals ---------- */

export function totalsOf(picks: Pick[]): Totals {
  const t = { proteinG: 0, calories: 0, sodiumMg: 0, potassiumMg: 0 };
  for (const p of picks) {
    t.proteinG += P(p.item) * p.servings;
    t.calories += K(p.item) * p.servings;
    t.sodiumMg += NA(p.item) * p.servings;
    t.potassiumMg += (p.item.kMgEst ?? 0) * p.servings;
  }
  return {
    proteinG: Math.round(t.proteinG * 10) / 10,
    calories: Math.round(t.calories),
    sodiumMg: Math.round(t.sodiumMg),
    potassiumMg: Math.round(t.potassiumMg),
  };
}

const addTotals = (a: Totals, b: Totals): Totals => ({
  proteinG: Math.round((a.proteinG + b.proteinG) * 10) / 10,
  calories: a.calories + b.calories,
  sodiumMg: a.sodiumMg + b.sodiumMg,
  potassiumMg: a.potassiumMg + b.potassiumMg,
});

/* ---------- one meal ---------- */

type Option = { item: Candidate; servings: number; p: number; k: number; na: number; pref: number };

function proteinCombo(pool: Candidate[], target: MealTarget, preferred: Set<string>, sodiumWeight: number): Pick[] {
  const opts: Option[] = [];
  for (const c of pool) {
    for (let s = 1; s <= MAX_SERVINGS; s++) {
      opts.push({
        item: c,
        servings: s,
        p: P(c) * s,
        k: K(c) * s,
        na: NA(c) * s,
        pref: preferred.has((c.station ?? "").toLowerCase()) ? 1 : 0,
      });
    }
  }
  // Leave room in the meal for a vegetable and a starch.
  const calBudget = target.calories * 0.75;
  const naBudget = target.sodiumMg * 0.7;
  const cost = (combo: Option[]) => {
    const p = combo.reduce((a, o) => a + o.p, 0);
    const k = combo.reduce((a, o) => a + o.k, 0);
    const na = combo.reduce((a, o) => a + o.na, 0);
    const extraServings = combo.reduce((a, o) => a + o.servings - 1, 0);
    const pref = combo.reduce((a, o) => a + o.pref, 0);
    return (
      Math.max(0, target.proteinG - p) * 10 + // short of protein: worst
      Math.max(0, p - (target.proteinG + 4)) * 1.5 + // over: less food to eat, more sodium
      Math.max(0, k - calBudget) * 0.05 +
      Math.max(0, na - naBudget) * 0.02 * sodiumWeight +
      na * 0.002 * sodiumWeight + // prefer less sodium per gram of protein
      k * 0.004 + // prefer protein per kcal
      extraServings * 0.5 -
      pref * 1.5
    );
  };

  let best: Option[] = [];
  let bestCost = opts.length ? Infinity : 0;
  const consider = (combo: Option[]) => {
    const c = cost(combo);
    if (c < bestCost - 1e-9) {
      best = combo;
      bestCost = c;
    }
  };
  for (let i = 0; i < opts.length; i++) {
    consider([opts[i]]);
    if (MAX_PROTEIN_DISHES < 2) continue;
    for (let j = i + 1; j < opts.length; j++) {
      if (opts[j].item.sourceId === opts[i].item.sourceId) continue; // one size of a dish at a time
      consider([opts[i], opts[j]]);
    }
  }
  return best.map((o) => ({ item: o.item, servings: o.servings, role: "protein" as const }));
}

function pickVegetable(pool: Candidate[], used: Set<string>): Candidate | null {
  const veg = pool.filter((c) => c.kind === "vegetable" && !used.has(c.sourceId));
  // A real side, not a garnish: some calories or a proper portion.
  const sides = veg.filter((c) => K(c) >= 20 || (grams(c) ?? 0) >= 75);
  const rank = (c: Candidate) => NA(c) + K(c) * 0.3;
  return [...(sides.length ? sides : veg)].sort((a, b) => rank(a) - rank(b) || a.id - b.id)[0] ?? null;
}

function pickStarch(pool: Candidate[], used: Set<string>, calRoom: number, naRoom: number): Candidate | null {
  const fits = pool.filter(
    (c) => c.kind === "starch" && !used.has(c.sourceId) && K(c) >= 60 && K(c) <= calRoom && NA(c) <= Math.max(naRoom, 60),
  );
  // Least sodium per kcal; then the bigger portion that still fits.
  return fits.sort((a, b) => NA(a) / K(a) - NA(b) / K(b) || K(b) - K(a) || a.id - b.id)[0] ?? null;
}

export function planMeal(
  meal: PlanMeal,
  menu: Candidate[],
  target: MealTarget,
  s: PlannerSettings,
  rejected: string[] = [],
  sodiumWeight = 1,
): MealPlan {
  const block = blockedMatcher(s.blockedFoods);
  const rej = new Set(rejected);
  const pool = menu
    .filter((c) => known(c) && c.kind !== "dessert" && !rej.has(c.sourceId) && !block?.(c))
    .sort((a, b) => a.id - b.id);
  const preferred = new Set(s.preferredStations.map((x) => x.toLowerCase()));

  const picks = proteinCombo(pool.filter(isProteinSource), target, preferred, sodiumWeight);
  const used = new Set(picks.map((p) => p.item.sourceId));
  const notes: string[] = [];

  if (meal !== "breakfast") {
    const v = pickVegetable(pool, used);
    if (v) {
      picks.push({ item: v, servings: 1, role: "vegetable" });
      used.add(v.sourceId);
    } else notes.push("No vegetable side on the menu.");
  }

  const t = totalsOf(picks);
  const st = pickStarch(pool, used, target.calories - t.calories, target.sodiumMg - t.sodiumMg);
  if (st) picks.push({ item: st, servings: 1, role: "starch" });

  const totals = totalsOf(picks);
  if (!picks.some((p) => p.role === "protein")) notes.push("No protein dish on the menu.");
  else if (totals.proteinG < target.proteinG - PROTEIN_BUFFER_G)
    notes.push(`${Math.round(target.proteinG - PROTEIN_BUFFER_G - totals.proteinG)} g short of this meal's protein.`);
  return { meal, picks, totals, target, fixed: false, notes };
}

/* ---------- whole day ---------- */

export function planDay(input: PlanInput): DayPlan {
  const { settings: s, menu } = input;
  const { meals: targets, day: budget } = mealTargets(s);
  const rejected = input.rejected ?? {};
  const meals = {} as Record<PlanMeal, MealPlan>;

  for (const m of PLAN_MEALS) {
    const fixed = input.fixed?.[m];
    meals[m] = fixed
      ? { meal: m, picks: fixed, totals: totalsOf(fixed), target: targets[m], fixed: true, notes: [] }
      : planMeal(m, menu[m] ?? [], targets[m], s, rejected[m]);
  }

  const dayTotals = () => PLAN_MEALS.reduce((a, m) => addTotals(a, meals[m].totals), totalsOf([]));
  const open = () => PLAN_MEALS.filter((m) => !meals[m].fixed);
  const refresh = (m: PlanMeal) => (meals[m] = { ...meals[m], totals: totalsOf(meals[m].picks) });

  // 4. Sodium over the cap: re-plan the meal furthest over its share, harder each time.
  for (let round = 1; round <= 3 && dayTotals().sodiumMg > budget.sodiumMg; round++) {
    const worst = open().sort(
      (a, b) => meals[b].totals.sodiumMg - meals[b].target.sodiumMg - (meals[a].totals.sodiumMg - meals[a].target.sodiumMg),
    )[0];
    if (!worst) break;
    const replanned = planMeal(worst, menu[worst] ?? [], targets[worst], s, rejected[worst], 1 + round * 3);
    if (replanned.totals.sodiumMg >= meals[worst].totals.sodiumMg) break;
    meals[worst] = replanned;
  }
  // ...then drop starches, saltiest first.
  while (dayTotals().sodiumMg > budget.sodiumMg) {
    const starch = open()
      .flatMap((m) => meals[m].picks.filter((p) => p.role === "starch").map((p) => ({ m, p })))
      .sort((a, b) => NA(b.p.item) * b.p.servings - NA(a.p.item) * a.p.servings)[0];
    if (!starch) break;
    meals[starch.m].picks = meals[starch.m].picks.filter((p) => p !== starch.p);
    refresh(starch.m);
  }

  // 5. Calories: top up with starch while under the range and sodium allows...
  for (let guard = 0; guard < 6 && dayTotals().calories < budget.caloriesMin; guard++) {
    const day = dayTotals();
    const room = budget.caloriesMax - day.calories;
    const naRoom = budget.sodiumMg - day.sodiumMg;
    type Step = { m: PlanMeal; apply: () => void; k: number; na: number };
    const steps: Step[] = [];
    for (const m of open()) {
      const mp = meals[m];
      const starch = mp.picks.find((p) => p.role === "starch");
      if (starch && starch.servings < MAX_SERVINGS) {
        steps.push({ m, k: K(starch.item), na: NA(starch.item), apply: () => (starch.servings += 1) });
      } else if (!starch) {
        const used = new Set(mp.picks.map((p) => p.item.sourceId));
        const pool = (menu[m] ?? []).filter((c) => known(c) && !(rejected[m] ?? []).includes(c.sourceId) && !isBlocked(c, s.blockedFoods));
        const c = pickStarch(pool, used, room, naRoom);
        if (c) steps.push({ m, k: K(c), na: NA(c), apply: () => mp.picks.push({ item: c, servings: 1, role: "starch" }) });
      }
    }
    const step = steps.filter((x) => x.k <= room && x.na <= naRoom).sort((a, b) => a.na / a.k - b.na / b.k)[0];
    if (!step) break;
    step.apply();
    refresh(step.m);
  }
  // ...and trim starch while over it.
  while (dayTotals().calories > budget.caloriesMax) {
    const starch = open()
      .flatMap((m) => meals[m].picks.filter((p) => p.role === "starch").map((p) => ({ m, p })))
      .sort((a, b) => K(b.p.item) * b.p.servings - K(a.p.item) * a.p.servings)[0];
    if (!starch) break;
    if (starch.p.servings > 1) starch.p.servings -= 1;
    else meals[starch.m].picks = meals[starch.m].picks.filter((p) => p !== starch.p);
    refresh(starch.m);
  }

  const totals = dayTotals();
  return { meals, totals, budget, warnings: dayWarnings(totals, budget) };
}

/** Where a day's planned meals miss the (meal-share) targets. Empty means on target. */
export function dayWarnings(totals: Totals, budget: DayBudget): string[] {
  const w: string[] = [];
  if (totals.proteinG < budget.proteinG)
    w.push(`${Math.round(budget.proteinG - totals.proteinG)} g short of protein from the dining hall.`);
  if (totals.sodiumMg > budget.sodiumMg) w.push(`Sodium ${totals.sodiumMg} mg is over the ${Math.round(budget.sodiumMg)} mg meal budget.`);
  if (totals.calories < budget.caloriesMin) w.push(`${totals.calories} kcal is under the ${Math.round(budget.caloriesMin)} kcal minimum.`);
  if (totals.calories > budget.caloriesMax) w.push(`${totals.calories} kcal is over the ${Math.round(budget.caloriesMax)} kcal maximum.`);
  return w;
}

/** Sum of several totals. */
export function sumTotals(list: Totals[]): Totals {
  return list.reduce(addTotals, totalsOf([]));
}
