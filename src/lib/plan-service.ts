import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { plan, type PlanItem } from "@/db/schema";
import { getFoodLogRange, getMenuForDate, getMenuItems, getPlans, getSettings, toCandidate } from "./data";
import { addDays } from "./dates";
import type { RecentMeals } from "./llm-plan";
import { planDayWithClaude } from "./llm-plan-service";
import { PLAN_MEALS, planDay, type DayPlan, type Pick, type PlanInput, type PlanMeal } from "./planner";

export type Engine = "llm" | "greedy";
export type PlanOptions = {
  /** "llm" asks Claude (Sonnet 5.5) and falls back to greedy; "greedy" is instant. Default greedy. */
  engine?: Engine;
  /** Re-plan only these meals; the others keep their current plan. Default: every meal that isn't locked or skipped. */
  only?: PlanMeal[];
};
export type PlanOutcome = { day: DayPlan; engine: Engine; fallbackReason?: string };

/**
 * (Re)plan a date from its ingested menu and save one `plan` row per meal.
 * Keeps rejections and skipped meals; never changes a locked meal (something
 * already ticked off). Returns null when there's no menu for the date.
 */
export async function generatePlan(date: string, opts: PlanOptions = {}): Promise<PlanOutcome | null> {
  const [settings, menu, existing] = await Promise.all([getSettings(), getMenuForDate(date), getPlans(date)]);
  if (PLAN_MEALS.every((m) => !menu[m].length)) return null;

  const byMeal = new Map(existing.map((p) => [p.meal, p]));
  const rejected: Partial<Record<PlanMeal, string[]>> = {};
  const fixed: Partial<Record<PlanMeal, Pick[]>> = {};
  const skipped = PLAN_MEALS.filter((m) => byMeal.get(m)?.skipped);
  // Meals kept as they are: locked ones, plus (with `only`) every meal not being re-planned.
  const held = PLAN_MEALS.filter((m) => {
    const row = byMeal.get(m);
    return row && !row.skipped && (row.locked || (opts.only && !opts.only.includes(m)));
  });

  const heldIds = held.flatMap((m) => byMeal.get(m)!.items.map((i) => i.itemId));
  const heldItems = new Map((await getMenuItems(heldIds)).map((i) => [i.id, toCandidate(i)]));
  for (const m of PLAN_MEALS) {
    const row = byMeal.get(m);
    if (row) rejected[m] = row.rejected;
    if (held.includes(m)) {
      fixed[m] = row!.items.flatMap((i) => {
        const item = heldItems.get(i.itemId);
        return item ? [{ item, servings: i.servings, role: i.role ?? "other" }] : [];
      });
    }
  }

  const input: PlanInput = { settings, menu, rejected, fixed, skipped };
  let outcome: PlanOutcome;
  let notes: Partial<Record<PlanMeal, string>> = {};
  if (opts.engine === "llm") {
    const r = await planDayWithClaude(input, await recentMeals(date));
    if (r.ok) {
      outcome = { day: r.day, engine: "llm" };
      notes = r.notes;
    } else {
      console.warn(`LLM plan for ${date} fell back to greedy: ${r.reason}`);
      outcome = { day: planDay(input), engine: "greedy", fallbackReason: r.reason };
    }
  } else {
    outcome = { day: planDay(input), engine: "greedy" };
  }

  const rows = PLAN_MEALS.map((m) => {
    const mp = outcome.day.meals[m];
    const row = byMeal.get(m);
    const kept = held.includes(m) && row;
    const items: PlanItem[] = mp.picks.map((p) => ({ itemId: p.item.id, servings: p.servings, role: p.role }));
    const reason = kept ? row.reason : [notes[m], ...mp.notes].filter(Boolean).join(" ") || null;
    return {
      date,
      meal: m,
      items,
      totals: mp.totals,
      reason,
      generator: kept ? row.generator : outcome.engine,
      locked: row?.locked ?? false,
      rejected: rejected[m] ?? [],
      skipped: skipped.includes(m),
    };
  });

  await db
    .insert(plan)
    .values(rows)
    .onConflictDoUpdate({
      target: [plan.date, plan.meal],
      set: {
        items: sql`excluded.items`,
        totals: sql`excluded.totals`,
        reason: sql`excluded.reason`,
        generator: sql`excluded.generator`,
        locked: sql`excluded.locked`,
        rejected: sql`excluded.rejected`,
        skipped: sql`excluded.skipped`,
        createdAt: sql`now()`,
      },
    });
  return outcome;
}

/** What was logged in the 4 days before `date`, for variety. */
async function recentMeals(date: string): Promise<RecentMeals> {
  const from = addDays(date, -4);
  const rows = await getFoodLogRange(from, addDays(date, -1));
  const out: RecentMeals = [];
  for (let i = 0; i < 4; i++) {
    const d = addDays(from, i);
    out.push({ date: d, foods: [...new Set(rows.filter((r) => r.date === d).map((r) => r.name))] });
  }
  return out.filter((r) => r.foods.length);
}

/**
 * Nightly (and "Pull menu now"): plan tomorrow with Claude, and today too if it
 * has no plan yet. Today's existing plan is left alone so it doesn't change
 * under you mid-day.
 */
export async function refreshPlans(today: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const todayHasPlan = (await getPlans(today)).length > 0;
  for (const [d, run] of [
    [today, !todayHasPlan],
    [addDays(today, 1), true],
  ] as const) {
    if (!run) {
      result[d] = "kept";
      continue;
    }
    try {
      const o = await generatePlan(d, { engine: "llm" });
      result[d] = o ? o.engine + (o.fallbackReason ? ` (fallback: ${o.fallbackReason})` : "") : "no menu";
    } catch (err) {
      result[d] = `error: ${(err as Error).message}`;
      console.error(`plan ${d}:`, (err as Error).message);
    }
  }
  return result;
}

/** Mark a meal skipped (or not) and re-plan the rest of the day around it. */
export async function setMealSkipped(date: string, meal: PlanMeal, skipped: boolean): Promise<PlanOutcome | null> {
  await db
    .insert(plan)
    .values({ date, meal, skipped })
    .onConflictDoUpdate({ target: [plan.date, plan.meal], set: { skipped } });
  return generatePlan(date, { engine: "llm" });
}
