import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseLocationRecipes } from "../menu/parse";
import { isBlocked, mealTargets, planDay, PLAN_MEALS, type Candidate, type PlanMeal, type PlannerSettings } from "../planner";

const DATE = "2026-11-24";
const FILES: Record<PlanMeal, string> = {
  breakfast: "location-recipes-2026-11-24-breakfast.json",
  lunch: "location-recipes-2026-11-24-lunch.json",
  dinner: "location-recipes-2026-11-24.json",
};

let nextId = 1;
const ids = new Map<string, number>();
const menu = Object.fromEntries(
  PLAN_MEALS.map((m) => {
    const parsed = parseLocationRecipes(
      JSON.parse(readFileSync(path.join(__dirname, "../../../fixtures", FILES[m]), "utf8")),
      DATE,
    );
    const cands: Candidate[] = parsed.items.map((i) => {
      const key = `${i.sourceId}|${i.servingSize}`;
      if (!ids.has(key)) ids.set(key, nextId++);
      return { ...i, id: ids.get(key)!, kMgEst: null };
    });
    return [m, cands];
  }),
) as Record<PlanMeal, Candidate[]>;

const SETTINGS: PlannerSettings = {
  proteinTargetG: 140,
  calorieTarget: 1750,
  calorieTolerance: 100,
  sodiumCapMg: 2300,
  proteinSplit: { breakfast: 30, lunch: 45, dinner: 45, snack: 20 },
  blockedFoods: ["pork", "tofu"],
  preferredStations: [],
};

const plan = planDay({ settings: SETTINGS, menu });

function describePlan(p = plan) {
  return PLAN_MEALS.map(
    (m) =>
      `${m}: ` +
      p.meals[m].picks.map((x) => `${x.item.name} [${x.item.servingSize}] ×${x.servings} (${x.role})`).join(", ") +
      ` → ${JSON.stringify(p.meals[m].totals)}`,
  ).join("\n");
}

describe("planDay on the 2026-11-24 menus", () => {
  it("prints the plan", () => {
    console.log(describePlan() + `\nday ${JSON.stringify(plan.totals)} warnings ${JSON.stringify(plan.warnings)}`);
  });

  it("hits the dining-hall protein share (140 − 20 g snack) with a buffer", () => {
    expect(plan.totals.proteinG).toBeGreaterThanOrEqual(120);
    // Whole servings only, and low-sodium protein is worth some overshoot (~20 g on this menu).
    expect(plan.totals.proteinG).toBeLessThanOrEqual(120 + 25);
    for (const m of PLAN_MEALS) expect(plan.meals[m].totals.proteinG).toBeGreaterThanOrEqual(SETTINGS.proteinSplit[m]);
  });

  it("stays under the sodium cap and within the calorie range (meal share)", () => {
    const { day } = mealTargets(SETTINGS);
    expect(plan.totals.sodiumMg).toBeLessThanOrEqual(day.sodiumMg);
    expect(plan.totals.calories).toBeGreaterThanOrEqual(day.caloriesMin);
    expect(plan.totals.calories).toBeLessThanOrEqual(day.caloriesMax);
    expect(plan.warnings).toEqual([]);
  });

  it("follows the eatable rules", () => {
    for (const m of PLAN_MEALS) {
      const picks = plan.meals[m].picks;
      expect(picks.filter((p) => p.role === "protein").length).toBeLessThanOrEqual(2);
      expect(picks.every((p) => p.servings >= 1 && p.servings <= 2)).toBe(true);
      expect(new Set(picks.map((p) => p.item.sourceId)).size).toBe(picks.length); // a dish once
      expect(picks.some((p) => p.item.kind === "dessert")).toBe(false);
      expect(picks.some((p) => isBlocked(p.item, SETTINGS.blockedFoods))).toBe(false);
      if (m !== "breakfast") expect(picks.some((p) => p.role === "vegetable")).toBe(true);
    }
  });

  it("blocks pork under its other names, but not plant-based look-alikes", () => {
    const all = PLAN_MEALS.flatMap((m) => menu[m]);
    const byName = (n: string) => all.find((c) => c.name === n)!;
    for (const n of ["Peameal Bacon", "Ham", "Pepperoni Pizza", "Chorizo Breakfast Wrap", "Chasu Pork Loin", "Shoyu Pork Broth", "Grilled Pork Chop"]) {
      expect(isBlocked(byName(n), ["pork"]), n).toBe(true);
    }
    expect(isBlocked(byName("Plant Based Sausage Bean Stew"), ["pork"])).toBe(false);
    expect(isBlocked({ ...byName("Peameal Bacon"), name: "Turkey Bacon", ingredients: "Turkey bacon" }, ["pork"])).toBe(false);
    expect(isBlocked(byName("Grilled Mojo Tofu"), ["tofu"])).toBe(true);
    expect(isBlocked(byName("Peameal Bacon"), [])).toBe(false);
  });

  it("is deterministic", () => {
    expect(describePlan(planDay({ settings: SETTINGS, menu }))).toBe(describePlan());
  });

  it("excludes rejected dishes and still meets the target", () => {
    const first = plan.meals.dinner.picks.find((p) => p.role === "protein")!.item;
    const again = planDay({ settings: SETTINGS, menu, rejected: { dinner: [first.sourceId] } });
    expect(again.meals.dinner.picks.some((p) => p.item.sourceId === first.sourceId)).toBe(false);
    expect(again.meals.dinner.totals.proteinG).toBeGreaterThanOrEqual(45);
  });

  it("keeps a fixed (already eaten) meal exactly", () => {
    const eaten = [{ item: menu.breakfast.find((c) => c.name === "Oatmeal")!, servings: 1, role: "starch" as const }];
    const p = planDay({ settings: SETTINGS, menu, fixed: { breakfast: eaten } });
    expect(p.meals.breakfast.fixed).toBe(true);
    expect(p.meals.breakfast.picks).toEqual(eaten);
    // The day is short on protein now, and says so.
    expect(p.warnings.join(" ")).toMatch(/short of protein/);
  });

  it("warns instead of crashing on an empty menu", () => {
    const p = planDay({ settings: SETTINGS, menu: { breakfast: [], lunch: [], dinner: [] } });
    expect(p.totals.proteinG).toBe(0);
    expect(p.meals.lunch.notes).toContain("No protein dish on the menu.");
    expect(p.warnings.length).toBeGreaterThan(0);
  });
});

describe("skipped meals", () => {
  it("moves a skipped meal's share to the other meals", () => {
    const { meals, day } = mealTargets(SETTINGS, ["breakfast"]);
    expect(meals.breakfast.proteinG).toBe(0);
    expect(meals.lunch.proteinG).toBeCloseTo(meals.dinner.proteinG);
    expect(meals.lunch.proteinG + meals.dinner.proteinG).toBeGreaterThanOrEqual(120);
    expect(day).toEqual(mealTargets(SETTINGS).day); // the day's targets don't change
  });

  it("plans lunch and dinner to cover a skipped breakfast", () => {
    const p = planDay({ settings: SETTINGS, menu, skipped: ["breakfast"] });
    expect(p.meals.breakfast.picks).toEqual([]);
    expect(p.meals.breakfast.skipped).toBe(true);
    expect(p.totals.proteinG).toBeGreaterThanOrEqual(120);
    expect(p.totals.sodiumMg).toBeLessThanOrEqual(mealTargets(SETTINGS).day.sodiumMg);
  });
});
