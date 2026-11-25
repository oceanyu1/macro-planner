import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { plan, type PlanItem } from "@/db/schema";
import { getMenuForDate, getMenuItems, getPlans, getSettings, toCandidate } from "./data";
import { PLAN_MEALS, planDay, type DayPlan, type Pick, type PlanMeal } from "./planner";

/**
 * (Re)plan a date from its ingested menu and save one `plan` row per meal.
 * Keeps each meal's rejections, and keeps locked meals (something already
 * ticked off) exactly as they were. Returns null when there's no menu.
 */
export async function generatePlan(date: string): Promise<DayPlan | null> {
  const [settings, menu, existing] = await Promise.all([getSettings(), getMenuForDate(date), getPlans(date)]);
  if (PLAN_MEALS.every((m) => !menu[m].length)) return null;

  const byMeal = new Map(existing.map((p) => [p.meal, p]));
  const rejected: Partial<Record<PlanMeal, string[]>> = {};
  const fixed: Partial<Record<PlanMeal, Pick[]>> = {};

  const lockedIds = existing.filter((p) => p.locked).flatMap((p) => p.items.map((i) => i.itemId));
  const lockedItems = new Map((await getMenuItems(lockedIds)).map((i) => [i.id, toCandidate(i)]));

  for (const m of PLAN_MEALS) {
    const row = byMeal.get(m);
    if (!row) continue;
    rejected[m] = row.rejected;
    if (row.locked) {
      fixed[m] = row.items.flatMap((i) => {
        const item = lockedItems.get(i.itemId);
        return item ? [{ item, servings: i.servings, role: i.role ?? "protein" }] : [];
      });
    }
  }

  const day = planDay({ settings, menu, rejected, fixed });

  const rows = PLAN_MEALS.map((m) => {
    const mp = day.meals[m];
    const items: PlanItem[] = mp.picks.map((p) => ({ itemId: p.item.id, servings: p.servings, role: p.role }));
    return {
      date,
      meal: m,
      items,
      totals: mp.totals,
      reason: mp.notes.join(" ") || null,
      generator: "greedy",
      locked: mp.fixed,
      rejected: rejected[m] ?? [],
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
        createdAt: sql`now()`,
      },
    });
  return day;
}
