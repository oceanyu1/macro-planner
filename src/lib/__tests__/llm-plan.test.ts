import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPlanPrompt, checkLlmPlan, plannableMenu, revisionPrompt, type PlanOutput } from "../llm-plan";
import { parseLocationRecipes } from "../menu/parse";
import { planDay, PLAN_MEALS, type Candidate, type PlanInput, type PlanMeal, type PlannerSettings } from "../planner";

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
    const parsed = parseLocationRecipes(JSON.parse(readFileSync(path.join(__dirname, "../../../fixtures", FILES[m]), "utf8")), DATE);
    return [
      m,
      parsed.items.map((i): Candidate => {
        const key = `${i.sourceId}|${i.servingSize}`;
        if (!ids.has(key)) ids.set(key, nextId++);
        return { ...i, id: ids.get(key)!, kMgEst: 100 };
      }),
    ];
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
const input: PlanInput = { settings: SETTINGS, menu };

/** The greedy plan, written as if Claude had returned it: a known-good plan. */
function greedyAsOutput(i: PlanInput = input): PlanOutput {
  const d = planDay(i);
  const meal = (m: PlanMeal) => ({
    items: d.meals[m].picks.map((p) => ({ id: p.item.id, servings: p.servings as 1 | 2 })),
    note: "",
  });
  return { breakfast: meal("breakfast"), lunch: meal("lunch"), dinner: meal("dinner") };
}
const byName = (m: PlanMeal, n: string) => menu[m].find((c) => c.name === n)!;

describe("plannableMenu", () => {
  it("leaves out blocked foods, desserts and sauces", () => {
    const names = PLAN_MEALS.flatMap((m) => plannableMenu(input, m).map((c) => c.name));
    expect(names).not.toContain("Peameal Bacon");
    expect(names).not.toContain("Grilled Pork Chop");
    expect(names).not.toContain("Grilled Mojo Tofu");
    expect(names).not.toContain("Sugar Cookie");
    expect(names).not.toContain("Ranch Dressing");
    expect(names).toContain("Grilled Chicken");
  });
  it("leaves out dishes rejected for that meal only", () => {
    const chicken = byName("dinner", "Grilled Chicken");
    const r = plannableMenu({ ...input, rejected: { dinner: [chicken.sourceId] } }, "dinner");
    expect(r.some((c) => c.sourceId === chicken.sourceId)).toBe(false);
  });
});

describe("buildPlanPrompt", () => {
  const prompt = buildPlanPrompt(
    { ...input, skipped: ["breakfast"] },
    [{ date: "2026-11-23", foods: ["Grilled Chicken", "Brown Rice"] }],
  );
  it("states targets, marks skipped meals and lists recent food", () => {
    expect(prompt).toMatch(/Protein: at least 120 g/);
    expect(prompt).toMatch(/## BREAKFAST\nSKIPPED/);
    expect(prompt).toMatch(/2026-11-23: Grilled Chicken, Brown Rice/);
  });
  it("never shows a blocked dish", () => {
    expect(prompt).not.toMatch(/Pork|Peameal|Tofu/);
  });
});

describe("checkLlmPlan", () => {
  it("accepts a plan that meets every rule and target", () => {
    const r = checkLlmPlan(greedyAsOutput(), input);
    expect(r.problems).toEqual([]);
    expect(r.day.totals.proteinG).toBeGreaterThanOrEqual(120);
  });

  it("recomputes totals from the menu instead of trusting the model", () => {
    const out = greedyAsOutput();
    const r = checkLlmPlan(out, input);
    const expected = PLAN_MEALS.flatMap((m) =>
      out[m].items.map((i) => (menu[m].find((c) => c.id === i.id)!.proteinG ?? 0) * i.servings),
    ).reduce((a, b) => a + b, 0);
    expect(r.day.totals.proteinG).toBeCloseTo(expected, 0);
  });

  it("rejects ids from another meal, blocked dishes and duplicates", () => {
    const out = greedyAsOutput();
    out.lunch.items.push({ id: byName("breakfast", "Oatmeal").id, servings: 1 });
    out.dinner.items.push({ id: byName("dinner", "Grilled Pork Chop").id, servings: 1 });
    out.dinner.items.push({ ...out.dinner.items[0] });
    const r = checkLlmPlan(out, input);
    expect(r.problems.join("\n")).toMatch(/lunch: id \d+ isn't on the lunch menu/);
    expect(r.problems.join("\n")).toMatch(/dinner: id \d+ isn't on the dinner menu/); // pork is filtered out
    expect(r.problems.join("\n")).toMatch(/listed more than once/);
  });

  it("enforces the eatable rules", () => {
    const out = greedyAsOutput();
    out.dinner.items = [
      { id: byName("dinner", "Grilled Chicken").id, servings: 2 },
      { id: byName("dinner", "Egg White").id, servings: 2 },
      { id: byName("dinner", "Togarashi Chicken").id, servings: 2 },
    ];
    const r = checkLlmPlan(out, input);
    expect(r.problems.join("\n")).toMatch(/dinner: 3 protein dishes/);
    expect(r.problems.join("\n")).toMatch(/dinner: no vegetable dish/);
  });

  it("flags a day short of protein and builds a revision request from it", () => {
    const out = greedyAsOutput();
    out.lunch.items = out.lunch.items.filter((i) => menu.lunch.find((c) => c.id === i.id)!.kind === "vegetable");
    const r = checkLlmPlan(out, input);
    expect(r.problems.some((p) => /short of protein/.test(p))).toBe(true);
    expect(revisionPrompt(r.problems, r.day)).toMatch(/^That plan doesn't work yet\. Recomputed from the menu/);
  });

  it("keeps fixed and skipped meals as they really are, whatever the model echoes", () => {
    const fixedBreakfast = [{ item: byName("breakfast", "Oatmeal"), servings: 1, role: "starch" as const }];
    const i: PlanInput = { ...input, fixed: { breakfast: fixedBreakfast }, skipped: ["lunch"] };
    const out = greedyAsOutput(i);
    out.breakfast.items = [{ id: 99999, servings: 2 }];
    out.lunch.items = [{ id: 99999, servings: 2 }];
    const r = checkLlmPlan(out, i);
    expect(r.day.meals.breakfast.picks).toEqual(fixedBreakfast);
    expect(r.day.meals.lunch.picks).toEqual([]);
    expect(r.problems.some((p) => /99999/.test(p))).toBe(false);
  });
});
