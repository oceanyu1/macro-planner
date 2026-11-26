import "server-only";
import { and, asc, between, count, desc, eq, inArray, max } from "drizzle-orm";
import { db } from "@/db";
import {
  application,
  favouriteFood,
  foodLog,
  habitDay,
  kMapping,
  mealTemplate,
  menuDay,
  menuItem,
  milestone,
  plan,
  settings,
} from "@/db/schema";
import type { Candidate, PlanMeal } from "./planner";
import { emptyHabit, type HabitRow } from "./habits";

export type Settings = typeof settings.$inferSelect;

export async function getSettings(): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  if (row) return row;
  const [created] = await db.insert(settings).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(settings).where(eq(settings.id, 1)))[0];
}

function toHabitRow(r: typeof habitDay.$inferSelect): HabitRow {
  return {
    date: r.date,
    waterMl: r.waterMl,
    neckSets: r.neckSets,
    gym: r.gym,
    tretinoin: r.tretinoin,
    leetcode: r.leetcode,
  };
}

export async function getHabit(date: string): Promise<HabitRow> {
  const [r] = await db.select().from(habitDay).where(eq(habitDay.date, date));
  return r ? toHabitRow(r) : emptyHabit(date);
}

export async function getHabitRange(from: string, to: string): Promise<HabitRow[]> {
  const rows = await db.select().from(habitDay).where(between(habitDay.date, from, to));
  return rows.map(toHabitRow);
}

export async function getFoodLog(date: string) {
  return db.select().from(foodLog).where(eq(foodLog.date, date)).orderBy(asc(foodLog.createdAt));
}

export async function getFoodLogRange(from: string, to: string) {
  return db.select().from(foodLog).where(between(foodLog.date, from, to));
}

export async function getFavourites() {
  return db.select().from(favouriteFood).orderBy(asc(favouriteFood.name));
}

export async function getTemplate() {
  return db.select().from(mealTemplate).orderBy(asc(mealTemplate.meal), asc(mealTemplate.sortOrder), asc(mealTemplate.id));
}

export async function getApplications() {
  return db.select().from(application).orderBy(desc(application.createdAt));
}

export async function getMilestones() {
  return db.select().from(milestone).orderBy(asc(milestone.project), asc(milestone.done), asc(milestone.sortOrder), asc(milestone.id));
}

export async function getTemplateLogged(date: string) {
  return db
    .select({ id: foodLog.id, name: foodLog.name, meal: foodLog.meal })
    .from(foodLog)
    .where(and(eq(foodLog.date, date), eq(foodLog.source, "template")));
}

/** Items ingested per date × meal, plus when the menu was last refreshed. */
export async function getMenuCoverage(from: string, to: string) {
  const [rows, [last]] = await Promise.all([
    db
      .select({ date: menuDay.date, meal: menuDay.meal, items: count() })
      .from(menuDay)
      .where(between(menuDay.date, from, to))
      .groupBy(menuDay.date, menuDay.meal),
    db.select({ at: max(menuItem.updatedAt) }).from(menuItem),
  ]);
  return { rows, lastUpdated: last?.at ?? null };
}

/** Everything served on a date, grouped by meal, in the planner's shape. */
export async function getMenuForDate(date: string): Promise<Record<PlanMeal, Candidate[]>> {
  const rows = await db
    .select({ meal: menuDay.meal, item: menuItem })
    .from(menuDay)
    .innerJoin(menuItem, eq(menuDay.menuItemId, menuItem.id))
    .where(eq(menuDay.date, date));
  const out: Record<PlanMeal, Candidate[]> = { breakfast: [], lunch: [], dinner: [] };
  for (const r of rows) if (r.meal !== "snack") out[r.meal].push(toCandidate(r.item));
  return out;
}

export function toCandidate(i: typeof menuItem.$inferSelect): Candidate {
  return {
    id: i.id,
    sourceId: i.sourceId,
    name: i.name,
    station: i.station,
    kind: i.kind,
    servingSize: i.servingSize,
    servingAmount: i.servingAmount,
    servingUnit: i.servingUnit,
    calories: i.calories,
    proteinG: i.proteinG,
    sodiumMg: i.sodiumMg,
    kMgEst: i.kMgEst,
    ingredients: i.ingredients,
  };
}

export async function getPlans(date: string) {
  return db.select().from(plan).where(eq(plan.date, date));
}

export async function getMenuItems(ids: number[]) {
  if (!ids.length) return [];
  return db.select().from(menuItem).where(inArray(menuItem.id, ids));
}

/** Plan items already ticked off (logged) on a date. */
export async function getPlanLogged(date: string) {
  return db
    .select({ id: foodLog.id, meal: foodLog.meal, menuItemId: foodLog.menuItemId })
    .from(foodLog)
    .where(and(eq(foodLog.date, date), eq(foodLog.source, "plan")));
}

/** Potassium review: every dish-name match, plus the menu items that use it. */
export async function getPotassiumReview() {
  const [maps, items] = await Promise.all([
    db.select().from(kMapping).orderBy(asc(kMapping.confirmed), asc(kMapping.ingredientText)),
    db
      .select({
        id: menuItem.id,
        name: menuItem.name,
        kind: menuItem.kind,
        ingredients: menuItem.ingredients,
        servingSize: menuItem.servingSize,
        kMgEst: menuItem.kMgEst,
      })
      .from(menuItem)
      .orderBy(asc(menuItem.servingAmount)),
  ]);
  return { maps, items };
}
