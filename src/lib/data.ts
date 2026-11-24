import "server-only";
import { and, asc, between, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  application,
  favouriteFood,
  foodLog,
  habitDay,
  mealTemplate,
  milestone,
  settings,
} from "@/db/schema";
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
