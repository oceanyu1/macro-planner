/**
 * Planner v2 (LLM), pure parts: the prompt, the output schema, and the checker.
 * Claude picks dishes; this code never trusts its arithmetic. `checkLlmPlan`
 * recomputes every total from the menu and lists what's wrong, which goes back
 * to Claude as a revision request. The API call itself is in llm-plan-service.ts.
 */
import { z } from "zod/v4";
import {
  dayWarnings,
  isBlocked,
  mealTargets,
  PLAN_MEALS,
  sumTotals,
  totalsOf,
  type Candidate,
  type DayPlan,
  type MealPlan,
  type Pick,
  type PlanInput,
  type PlanMeal,
  type Role,
} from "./planner";

/* ---------- output schema ---------- */

const MealPick = z.object({
  id: z.number().int().describe("Dish id from that meal's menu"),
  servings: z.union([z.literal(1), z.literal(2)]),
});
const MealOut = z.object({
  items: z.array(MealPick),
  note: z.string().describe("One short sentence on why this meal, for the person eating it"),
});
export const PlanOutput = z.object({ breakfast: MealOut, lunch: MealOut, dinner: MealOut });
export type PlanOutput = z.infer<typeof PlanOutput>;

/* ---------- what Claude may choose from ---------- */

/** Kinds Claude may plan. Desserts, drinks and sauces never count toward a plan. */
const PLANNABLE = new Set(["protein", "dairy", "vegetable", "starch", "fruit", "other"]);

/** The menu Claude sees for one meal: known nutrition, not blocked, not rejected, a plannable kind. */
export function plannableMenu(input: PlanInput, meal: PlanMeal): Candidate[] {
  const rejected = new Set(input.rejected?.[meal] ?? []);
  return (input.menu[meal] ?? [])
    .filter(
      (c) =>
        c.calories != null &&
        c.proteinG != null &&
        c.sodiumMg != null &&
        PLANNABLE.has(c.kind ?? "other") &&
        !rejected.has(c.sourceId) &&
        !isBlocked(c, input.settings.blockedFoods),
    )
    .sort((a, b) => a.id - b.id);
}

export function roleOf(c: Candidate): Role {
  if (c.kind === "protein" || c.kind === "dairy") return "protein";
  if (c.kind === "vegetable") return "vegetable";
  if (c.kind === "starch") return "starch";
  return "other";
}

/* ---------- prompt ---------- */

/** Stable across days (cached): who Claude is and the rules. Day-specific data goes in the user turn. */
export const SYSTEM_PROMPT = `You plan one day of meals at a university dining hall for one student. The student eats exactly what you plan, so the plan has to be food a person would actually want to eat together, not just numbers that add up.

You get each meal's menu as a list of dishes with an id, serving size, and nutrition per serving. Choose dishes by id and say 1 or 2 servings of each.

Hard rules. A plan that breaks one is rejected:
- Only use ids from that meal's own menu.
- Hit the day's protein target from the dining hall, and each meal's protein target as closely as you can.
- Keep the day's sodium under the cap and calories inside the range.
- At most 2 protein dishes per meal (protein, eggs, yogurt and other dairy count). At most 2 servings of any dish. Don't list a dish twice in a meal.
- Lunch and dinner each include at least one vegetable dish.
- Meals marked FIXED are already decided: return exactly those items. Meals marked SKIPPED: return no items.

Make it a good plan:
- Build meals that go together (a main, a vegetable, a starch from the same station or cuisine), not random high-protein items.
- Prefer lean, lower-sodium protein. Grilled chicken, fish, eggs, Greek yogurt and lean beef are good; breaded or sauced dishes cost sodium.
- Vary the protein between lunch and dinner, and avoid repeating what the student ate in the last few days when there's a good alternative.
- Prefer potassium-rich vegetables and starches when it's a close call (K is given in mg; "?" means unknown).
- Keep it eatable: a reasonable number of items per meal, and portions a person can finish.

The "note" for each meal is one plain sentence the student will see, saying what the meal is and why (e.g. "Grilled chicken with brown rice and broccoli: lean and low in sodium."). Leave it empty for SKIPPED meals.`;

const fmt = (n: number | null | undefined, d = 0) => (n == null ? "?" : n.toFixed(d));

function menuTable(items: Candidate[]): string {
  const rows = items.map(
    (c) =>
      `${c.id} | ${c.name} | ${c.servingSize} | ${fmt(c.proteinG, 1)} g P | ${fmt(c.calories)} kcal | ${fmt(c.sodiumMg)} mg Na | ${fmt(c.kMgEst)} mg K | ${c.kind ?? "other"} | ${c.station ?? ""}`,
  );
  return ["id | dish | serving | protein | calories | sodium | potassium | kind | station", ...rows].join("\n");
}

export type RecentMeals = { date: string; foods: string[] }[];

/** The first user turn: today's targets, menus, fixed/skipped meals and recent history. */
export function buildPlanPrompt(input: PlanInput, recent: RecentMeals = []): string {
  const skipped = input.skipped ?? [];
  const { meals: t, day } = mealTargets(input.settings, skipped);
  const parts: string[] = [];
  parts.push(
    `Day targets from the dining hall (the student covers a ${input.settings.proteinSplit.snack ?? 0} g protein snack separately):`,
    `- Protein: at least ${Math.round(day.proteinG)} g, ideally ${Math.round(day.proteinG)}–${Math.round(day.proteinG + 12)} g`,
    `- Calories: ${Math.round(day.caloriesMin)}–${Math.round(day.caloriesMax)} kcal`,
    `- Sodium: under ${Math.round(day.sodiumMg)} mg`,
    "",
    "Per-meal guide:",
    ...PLAN_MEALS.map((m) =>
      skipped.includes(m)
        ? `- ${m}: SKIPPED`
        : `- ${m}: about ${Math.round(t[m].proteinG)} g protein, ~${Math.round(t[m].calories)} kcal, under ~${Math.round(t[m].sodiumMg)} mg sodium`,
    ),
  );
  for (const m of PLAN_MEALS) {
    parts.push("", `## ${m.toUpperCase()}`);
    if (skipped.includes(m)) {
      parts.push("SKIPPED: return no items.");
      continue;
    }
    const fixed = input.fixed?.[m];
    if (fixed) {
      parts.push(
        "FIXED (already decided, return exactly these):",
        ...fixed.map((p) => `- id ${p.item.id} × ${p.servings}: ${p.item.name} (${p.item.servingSize})`),
      );
      continue;
    }
    parts.push(menuTable(plannableMenu(input, m)));
  }
  if (recent.length) {
    parts.push("", "What the student ate recently (for variety):");
    for (const r of recent) parts.push(`- ${r.date}: ${r.foods.join(", ") || "nothing logged"}`);
  }
  parts.push("", "Plan the day.");
  return parts.join("\n");
}

/* ---------- checking Claude's plan ---------- */

export type CheckResult = { day: DayPlan; problems: string[]; notes: Record<PlanMeal, string> };

/**
 * Turn Claude's output into a DayPlan using real menu data, and list every rule
 * or target it misses. An empty `problems` list means the plan can be shown.
 */
export function checkLlmPlan(out: PlanOutput, input: PlanInput): CheckResult {
  const skipped = input.skipped ?? [];
  const { meals: targets, day: budget } = mealTargets(input.settings, skipped);
  const problems: string[] = [];
  const meals = {} as Record<PlanMeal, MealPlan>;
  const notes = {} as Record<PlanMeal, string>;

  for (const m of PLAN_MEALS) {
    notes[m] = out[m].note.trim();
    if (skipped.includes(m)) {
      meals[m] = { meal: m, picks: [], totals: totalsOf([]), target: targets[m], fixed: true, skipped: true, notes: [] };
      continue;
    }
    const fixed = input.fixed?.[m];
    if (fixed) {
      // Already decided: use what's really fixed, whatever Claude echoed.
      meals[m] = { meal: m, picks: fixed, totals: totalsOf(fixed), target: targets[m], fixed: true, notes: [] };
      continue;
    }

    const menu = new Map(plannableMenu(input, m).map((c) => [c.id, c]));
    const picks: Pick[] = [];
    const seenDish = new Set<string>();
    for (const it of out[m].items) {
      const c = menu.get(it.id);
      if (!c) {
        problems.push(`${m}: id ${it.id} isn't on the ${m} menu.`);
        continue;
      }
      if (seenDish.has(c.sourceId)) {
        problems.push(`${m}: ${c.name} is listed more than once.`);
        continue;
      }
      seenDish.add(c.sourceId);
      picks.push({ item: c, servings: it.servings, role: roleOf(c) });
    }

    const proteinDishes = picks.filter((p) => p.role === "protein").length;
    if (proteinDishes > 2) problems.push(`${m}: ${proteinDishes} protein dishes; the limit is 2.`);
    if (m !== "breakfast" && !picks.some((p) => p.role === "vegetable"))
      problems.push(`${m}: no vegetable dish; lunch and dinner need one.`);

    const totals = totalsOf(picks);
    if (totals.proteinG < targets[m].proteinG * 0.6)
      problems.push(`${m}: ${totals.proteinG} g protein is far below its ~${Math.round(targets[m].proteinG)} g share.`);
    meals[m] = { meal: m, picks, totals, target: targets[m], fixed: false, notes: [] };
  }

  const totals = sumTotals(PLAN_MEALS.map((m) => meals[m].totals));
  problems.push(...dayWarnings(totals, budget).map((w) => `Day: ${w}`));
  return { day: { meals, totals, budget, warnings: dayWarnings(totals, budget) }, problems, notes };
}

/** The revision request sent back to Claude. */
export function revisionPrompt(problems: string[], day: DayPlan): string {
  const t = day.totals;
  return [
    "That plan doesn't work yet. Recomputed from the menu, it comes to " +
      `${t.proteinG} g protein, ${t.calories} kcal and ${t.sodiumMg} mg sodium. Problems:`,
    ...problems.map((p) => `- ${p}`),
    "",
    "Fix these and return the full corrected plan.",
  ].join("\n");
}
