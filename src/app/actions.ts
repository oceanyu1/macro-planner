"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  application,
  applicationStatusEnum,
  favouriteFood,
  foodLog,
  habitDay,
  mealEnum,
  mealTemplate,
  milestone,
  settings,
} from "@/db/schema";
import { isValidIsoDate } from "@/lib/dates";
import { requireUser } from "@/lib/session";

const isoDate = z.string().refine(isValidIsoDate, "bad date");
const meal = z.enum(mealEnum.enumValues);
const num = z.coerce.number().finite();
const nonNeg = num.min(0);

function done() {
  revalidatePath("/", "layout");
}

/* ---------- habits ---------- */

const counterField = { waterMl: habitDay.waterMl, neckSets: habitDay.neckSets, leetcode: habitDay.leetcode } as const;

export async function adjustHabit(date: string, field: keyof typeof counterField, delta: number) {
  await requireUser();
  const d = isoDate.parse(date);
  const n = z.number().int().min(-5000).max(5000).parse(delta);
  const col = counterField[z.enum(["waterMl", "neckSets", "leetcode"]).parse(field)];
  await db
    .insert(habitDay)
    .values({ date: d, [field]: Math.max(0, n) })
    .onConflictDoUpdate({
      target: habitDay.date,
      set: { [field]: sql`greatest(0, ${col} + ${n})`, updatedAt: sql`now()` },
    });
  done();
}

export async function setGym(date: string, gym: "upper" | "lower" | null) {
  await requireUser();
  const d = isoDate.parse(date);
  const g = z.enum(["upper", "lower"]).nullable().parse(gym);
  await db
    .insert(habitDay)
    .values({ date: d, gym: g })
    .onConflictDoUpdate({ target: habitDay.date, set: { gym: g, updatedAt: sql`now()` } });
  done();
}

export async function setTretinoin(date: string, value: boolean) {
  await requireUser();
  const d = isoDate.parse(date);
  const v = z.boolean().parse(value);
  await db
    .insert(habitDay)
    .values({ date: d, tretinoin: v })
    .onConflictDoUpdate({ target: habitDay.date, set: { tretinoin: v, updatedAt: sql`now()` } });
  done();
}

/* ---------- food log ---------- */

const foodForm = z.object({
  date: isoDate,
  meal,
  name: z.string().trim().min(1).max(120),
  servings: num.positive().max(20).default(1),
  proteinG: nonNeg.default(0),
  calories: nonNeg.default(0),
  sodiumMg: nonNeg.default(0),
  potassiumMg: nonNeg.default(0),
  kIsEstimate: z.boolean(),
  saveFavourite: z.boolean(),
});

/** Quick-add: values are per serving; the log stores servings × values. */
export async function addFood(formData: FormData) {
  await requireUser();
  const f = foodForm.parse({
    ...Object.fromEntries(formData),
    kIsEstimate: formData.get("kExact") !== "on",
    saveFavourite: formData.get("saveFavourite") === "on",
  });
  await db.insert(foodLog).values({
    date: f.date,
    meal: f.meal,
    name: f.name,
    servings: f.servings,
    proteinG: f.proteinG * f.servings,
    calories: Math.round(f.calories * f.servings),
    sodiumMg: Math.round(f.sodiumMg * f.servings),
    potassiumMg: Math.round(f.potassiumMg * f.servings),
    kIsEstimate: f.kIsEstimate,
    source: "manual",
  });
  if (f.saveFavourite) {
    const fav = {
      proteinG: f.proteinG,
      calories: Math.round(f.calories),
      sodiumMg: Math.round(f.sodiumMg),
      potassiumMg: Math.round(f.potassiumMg),
      kIsEstimate: f.kIsEstimate,
    };
    await db
      .insert(favouriteFood)
      .values({ name: f.name, ...fav })
      .onConflictDoUpdate({ target: favouriteFood.name, set: fav });
  }
  done();
}

export async function logFavourite(date: string, mealName: string, favouriteId: number) {
  await requireUser();
  const [fav] = await db.select().from(favouriteFood).where(eq(favouriteFood.id, z.number().int().parse(favouriteId)));
  if (!fav) return;
  await db.insert(foodLog).values({
    date: isoDate.parse(date),
    meal: meal.parse(mealName),
    name: fav.name,
    servings: 1,
    proteinG: fav.proteinG,
    calories: fav.calories,
    sodiumMg: fav.sodiumMg,
    potassiumMg: fav.potassiumMg,
    kIsEstimate: fav.kIsEstimate,
    source: "manual",
  });
  done();
}

export async function deleteFavourite(id: number) {
  await requireUser();
  await db.delete(favouriteFood).where(eq(favouriteFood.id, z.number().int().parse(id)));
  done();
}

export async function deleteFood(id: number) {
  await requireUser();
  await db.delete(foodLog).where(eq(foodLog.id, z.number().int().parse(id)));
  done();
}

/** Home mode: tick a template item eaten (or untick it). */
export async function toggleTemplateItem(date: string, templateId: number) {
  await requireUser();
  const d = isoDate.parse(date);
  const [t] = await db.select().from(mealTemplate).where(eq(mealTemplate.id, z.number().int().parse(templateId)));
  if (!t) return;
  const existing = await db
    .select({ id: foodLog.id })
    .from(foodLog)
    .where(and(eq(foodLog.date, d), eq(foodLog.meal, t.meal), eq(foodLog.name, t.name), eq(foodLog.source, "template")));
  if (existing.length) {
    await db.delete(foodLog).where(eq(foodLog.id, existing[0].id));
  } else {
    await db.insert(foodLog).values({
      date: d,
      meal: t.meal,
      name: t.name,
      servings: t.servings,
      proteinG: t.proteinG,
      calories: t.calories,
      sodiumMg: t.sodiumMg,
      potassiumMg: t.potassiumMg,
      kIsEstimate: true,
      source: "template",
    });
  }
  done();
}

/* ---------- home meal template ---------- */

const templateForm = z.object({
  meal,
  name: z.string().trim().min(1).max(120),
  servings: num.positive().max(20).default(1),
  proteinG: nonNeg.default(0),
  calories: nonNeg.default(0),
  sodiumMg: nonNeg.default(0),
  potassiumMg: nonNeg.default(0),
});

/** Template rows store the totals for the stated servings. */
export async function addTemplateItem(formData: FormData) {
  await requireUser();
  const f = templateForm.parse(Object.fromEntries(formData));
  await db.insert(mealTemplate).values({
    ...f,
    calories: Math.round(f.calories),
    sodiumMg: Math.round(f.sodiumMg),
    potassiumMg: Math.round(f.potassiumMg),
  });
  done();
}

export async function deleteTemplateItem(id: number) {
  await requireUser();
  await db.delete(mealTemplate).where(eq(mealTemplate.id, z.number().int().parse(id)));
  done();
}

/* ---------- settings ---------- */

const settingsForm = z.object({
  mode: z.enum(["home", "dining"]),
  proteinTargetG: nonNeg,
  calorieTarget: nonNeg,
  calorieTolerance: nonNeg,
  sodiumCapMg: nonNeg,
  potassiumGoalMg: nonNeg,
  splitBreakfast: nonNeg,
  splitLunch: nonNeg,
  splitDinner: nonNeg,
  splitSnack: nonNeg,
  blockedFoods: z.string().default(""),
  preferredStations: z.string().default(""),
  waterGoalMl: nonNeg,
  neckSetsGoal: nonNeg,
  gymPerWeek: num.int().min(0).max(14),
  leetcodeGoal: nonNeg,
  tretinoinStart: z.union([z.literal(""), isoDate]).default(""),
});

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

export async function saveSettings(formData: FormData) {
  await requireUser();
  const f = settingsForm.parse(Object.fromEntries(formData));
  const values = {
    mode: f.mode,
    proteinTargetG: Math.round(f.proteinTargetG),
    calorieTarget: Math.round(f.calorieTarget),
    calorieTolerance: Math.round(f.calorieTolerance),
    sodiumCapMg: Math.round(f.sodiumCapMg),
    potassiumGoalMg: Math.round(f.potassiumGoalMg),
    proteinSplit: { breakfast: f.splitBreakfast, lunch: f.splitLunch, dinner: f.splitDinner, snack: f.splitSnack },
    blockedFoods: list(f.blockedFoods),
    preferredStations: list(f.preferredStations),
    waterGoalMl: Math.round(f.waterGoalMl),
    neckSetsGoal: Math.round(f.neckSetsGoal),
    gymPerWeek: f.gymPerWeek,
    leetcodeGoal: Math.round(f.leetcodeGoal),
    tretinoinStart: f.tretinoinStart || null,
    updatedAt: new Date(),
  };
  await db
    .insert(settings)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: settings.id, set: values });
  done();
}

/* ---------- long goals ---------- */

const appForm = z.object({
  company: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(120),
  status: z.enum(applicationStatusEnum.enumValues).default("applied"),
  appliedOn: z.union([z.literal(""), isoDate]).default(""),
  link: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
});

export async function addApplication(formData: FormData) {
  await requireUser();
  const f = appForm.parse(Object.fromEntries(formData));
  await db.insert(application).values({ ...f, appliedOn: f.appliedOn || null, link: f.link ?? null });
  done();
}

export async function setApplicationStatus(id: number, status: string) {
  await requireUser();
  await db
    .update(application)
    .set({ status: z.enum(applicationStatusEnum.enumValues).parse(status) })
    .where(eq(application.id, z.number().int().parse(id)));
  done();
}

export async function deleteApplication(id: number) {
  await requireUser();
  await db.delete(application).where(eq(application.id, z.number().int().parse(id)));
  done();
}

const msForm = z.object({
  project: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(200),
  dueDate: z.union([z.literal(""), isoDate]).default(""),
});

export async function addMilestone(formData: FormData) {
  await requireUser();
  const f = msForm.parse(Object.fromEntries(formData));
  await db.insert(milestone).values({ ...f, dueDate: f.dueDate || null });
  done();
}

export async function toggleMilestone(id: number, today: string) {
  await requireUser();
  const mid = z.number().int().parse(id);
  const d = isoDate.parse(today);
  await db
    .update(milestone)
    .set({
      done: sql`not ${milestone.done}`,
      doneAt: sql`case when ${milestone.done} then null else ${d}::date end`,
    })
    .where(eq(milestone.id, mid));
  done();
}

export async function deleteMilestone(id: number) {
  await requireUser();
  await db.delete(milestone).where(eq(milestone.id, z.number().int().parse(id)));
  done();
}

