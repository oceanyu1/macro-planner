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
  menuItem,
  milestone,
  plan,
  settings,
} from "@/db/schema";
import { isValidIsoDate, today } from "@/lib/dates";
import { ingestRange } from "@/lib/menu/ingest";
import { generatePlan, refreshPlans, setMealSkipped } from "@/lib/plan-service";
import { confirmPotassiumMatches, estimateMenuPotassium, setPotassiumMatch } from "@/lib/potassium-service";
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


/* ---------- menu ---------- */

/**
 * "Pull menu now" on Settings: the same 7-day ingest the cron runs, but it
 * works in home mode too. Returns a one-line summary for useActionState.
 */
export async function pullMenu(): Promise<string> {
  await requireUser();
  const start = today();
  const r = await ingestRange(start, 7);
  const k = await estimateMenuPotassium();
  await refreshPlans(start);
  done();
  const items = r.days.reduce((a, d) => a + d.meals.reduce((b, m) => b + m.items, 0), 0);
  const errors = r.days.flatMap((d) => d.meals.filter((m) => m.error).map((m) => `${d.date} ${m.meal}: ${m.error}`));
  const head =
    `${items} menu rows over ${r.days.length} days, ${r.requests} requests, ${(r.ms / 1000).toFixed(1)} s.` +
    (k.newMatches ? ` Potassium estimated for ${k.newMatches} new dishes.` : "");
  return errors.length ? `${head} ${errors.length} failed: ${errors.slice(0, 3).join("; ")}` : head;
}

/* ---------- plan (dining mode) ---------- */

const planMeal = z.enum(["breakfast", "lunch", "dinner"]);

/** Plan (or re-plan) a whole day with Claude (falls back to greedy). Locked meals, skips and rejections are kept. */
export async function planDate(date: string) {
  await requireUser();
  await generatePlan(isoDate.parse(date), { engine: "llm" });
  done();
}

/** "Skipped this meal" (or undo): move its share to the remaining meals and re-plan them. */
export async function skipMeal(date: string, mealName: string, skipped: boolean) {
  await requireUser();
  await setMealSkipped(isoDate.parse(date), planMeal.parse(mealName), z.boolean().parse(skipped));
  done();
}

/** ✕ on a planned dish: never suggest it again for this meal today, and re-plan. */
export async function rejectPlanItem(date: string, mealName: string, sourceId: string) {
  await requireUser();
  const d = isoDate.parse(date);
  const m = planMeal.parse(mealName);
  const s = z.string().min(1).max(40).parse(sourceId);
  await db
    .update(plan)
    .set({ rejected: sql`array_append(array_remove(${plan.rejected}, ${s}), ${s})` })
    .where(and(eq(plan.date, d), eq(plan.meal, m)));
  // Instant: re-plan just this meal with the greedy planner; the other meals stay as they are.
  await generatePlan(d, { only: [m] });
  done();
}

/** Bring back everything rejected for a meal, and re-plan. */
export async function clearRejected(date: string, mealName: string) {
  await requireUser();
  const d = isoDate.parse(date);
  const m = planMeal.parse(mealName);
  await db
    .update(plan)
    .set({ rejected: [] })
    .where(and(eq(plan.date, d), eq(plan.meal, m)));
  await generatePlan(d, { only: [m] });
  done();
}

/**
 * Tick a planned dish eaten (logs it, snapshotting its nutrients) or untick it.
 * A meal with anything ticked is locked, so re-planning leaves it alone.
 */
export async function togglePlanItem(date: string, mealName: string, itemId: number) {
  await requireUser();
  const d = isoDate.parse(date);
  const m = planMeal.parse(mealName);
  const id = z.number().int().parse(itemId);

  const [row] = await db.select().from(plan).where(and(eq(plan.date, d), eq(plan.meal, m)));
  const planned = row?.items.find((i) => i.itemId === id);
  if (!row || !planned) return;

  const existing = await db
    .select({ id: foodLog.id })
    .from(foodLog)
    .where(and(eq(foodLog.date, d), eq(foodLog.meal, m), eq(foodLog.menuItemId, id), eq(foodLog.source, "plan")));

  if (existing.length) {
    await db.delete(foodLog).where(eq(foodLog.id, existing[0].id));
  } else {
    const [item] = await db.select().from(menuItem).where(eq(menuItem.id, id));
    if (!item) return;
    const n = planned.servings;
    await db.insert(foodLog).values({
      date: d,
      meal: m,
      menuItemId: id,
      name: item.name,
      servings: n,
      proteinG: (item.proteinG ?? 0) * n,
      calories: Math.round((item.calories ?? 0) * n),
      sodiumMg: Math.round((item.sodiumMg ?? 0) * n),
      potassiumMg: Math.round((item.kMgEst ?? 0) * n),
      kIsEstimate: true,
      source: "plan",
    });
  }

  const [{ ticked }] = await db
    .select({ ticked: sql<number>`count(*)::int` })
    .from(foodLog)
    .where(and(eq(foodLog.date, d), eq(foodLog.meal, m), eq(foodLog.source, "plan")));
  await db
    .update(plan)
    .set({ locked: ticked > 0 })
    .where(and(eq(plan.date, d), eq(plan.meal, m)));
  done();
}

/* ---------- potassium review ---------- */

const kKey = z.string().trim().min(1).max(200);

/** "Looks right": keep the suggested CNF food for this dish. */
export async function confirmKMatch(key: string) {
  await requireUser();
  await confirmPotassiumMatches([kKey.parse(key)]);
  revalidatePath("/settings/potassium");
}

export async function confirmAllKMatches() {
  await requireUser();
  await confirmPotassiumMatches("all");
  revalidatePath("/settings/potassium");
}

/** Pick a different CNF food for a dish (null = no good match: potassium unknown). */
export async function changeKMatch(key: string, foodCode: number | null) {
  await requireUser();
  await setPotassiumMatch(kKey.parse(key), z.number().int().positive().nullable().parse(foodCode));
  done();
}
