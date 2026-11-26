import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { menuDay, menuItem, type MealName } from "@/db/schema";
import { addDays } from "@/lib/dates";
import { HEADERS, INGEST_MEALS, locationRecipesUrl } from "./api";
import { MenuResponseError, parseLocationRecipes, type ParsedMenuItem } from "./parse";

type Meal = Exclude<MealName, "snack">;

export type MealReport = { meal: Meal; items: number; period?: number; error?: string };
export type DayReport = { date: string; meals: MealReport[] };
export type IngestReport = { ok: boolean; days: DayReport[]; requests: number; ms: number };

const FETCH_TIMEOUT_MS = 20_000;
/** Stop starting new days after this long, so the function finishes inside maxDuration. */
const BUDGET_MS = 150_000; // leaves the rest of the 300 s function for the Claude plans

/** Fetch and parse one date × meal period. Retries once on a network error or 5xx. */
async function fetchMeal(date: string, period: number, counter: { n: number }) {
  for (let attempt = 0; ; attempt++) {
    counter.n++;
    try {
      const res = await fetch(locationRecipesUrl(date, period), {
        headers: HEADERS,
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status >= 500 && attempt === 0) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new MenuResponseError(`HTTP ${res.status} ${res.statusText}`); // 4xx: don't retry
      return parseLocationRecipes(await res.json(), date);
    } catch (err) {
      if (attempt > 0 || err instanceof MenuResponseError) throw err;
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}

/**
 * Replace what's served at one date × meal. Items are upserted by
 * (source_id, serving_size) so a dish keeps its id (and its potassium mapping)
 * across the menu cycle; the day's rows are rewritten in one transaction.
 */
export async function saveMeal(date: string, meal: Meal, items: ParsedMenuItem[]): Promise<void> {
  await db.transaction(async (tx) => {
    let ids: { id: number; sourceId: string; servingSize: string }[] = [];
    if (items.length) {
      ids = await tx
        .insert(menuItem)
        .values(
          items.map((i) => ({
            sourceId: i.sourceId,
            name: i.name,
            station: i.station,
            kind: i.kind,
            servingSize: i.servingSize,
            servingAmount: i.servingAmount,
            servingUnit: i.servingUnit,
            calories: i.calories,
            fatG: i.fatG,
            satFatG: i.satFatG,
            transFatG: i.transFatG,
            cholesterolMg: i.cholesterolMg,
            sodiumMg: i.sodiumMg,
            carbsG: i.carbsG,
            fiberG: i.fiberG,
            sugarsG: i.sugarsG,
            proteinG: i.proteinG,
            ingredients: i.ingredients,
            allergens: i.allergens,
          })),
        )
        .onConflictDoUpdate({
          target: [menuItem.sourceId, menuItem.servingSize],
          set: {
            name: sql`excluded.name`,
            station: sql`excluded.station`,
            // Keep a kind someone corrected by hand.
            kind: sql`coalesce(${menuItem.kind}, excluded.kind)`,
            servingAmount: sql`excluded.serving_amount`,
            servingUnit: sql`excluded.serving_unit`,
            calories: sql`excluded.calories`,
            fatG: sql`excluded.fat_g`,
            satFatG: sql`excluded.sat_fat_g`,
            transFatG: sql`excluded.trans_fat_g`,
            cholesterolMg: sql`excluded.cholesterol_mg`,
            sodiumMg: sql`excluded.sodium_mg`,
            carbsG: sql`excluded.carbs_g`,
            fiberG: sql`excluded.fiber_g`,
            sugarsG: sql`excluded.sugars_g`,
            proteinG: sql`excluded.protein_g`,
            ingredients: sql`excluded.ingredients`,
            allergens: sql`excluded.allergens`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: menuItem.id, sourceId: menuItem.sourceId, servingSize: menuItem.servingSize });
    }

    const station = new Map(items.map((i) => [`${i.sourceId}|${i.servingSize}`, i.station]));
    await tx.delete(menuDay).where(and(eq(menuDay.date, date), eq(menuDay.meal, meal)));
    if (ids.length) {
      await tx.insert(menuDay).values(
        ids.map((r) => ({ date, meal, menuItemId: r.id, station: station.get(`${r.sourceId}|${r.servingSize}`) ?? null })),
      );
    }
  });
}

/** Pull one date: breakfast, lunch (falling back to brunch), dinner. Meals fail independently. */
export async function ingestDate(date: string, counter = { n: 0 }): Promise<DayReport> {
  const meals: MealReport[] = [];
  for (const { meal, periods } of INGEST_MEALS) {
    try {
      let items: ParsedMenuItem[] = [];
      let used = periods[0];
      for (const period of periods) {
        used = period;
        items = (await fetchMeal(date, period, counter)).items;
        if (items.length) break;
      }
      await saveMeal(date, meal, items);
      meals.push({ meal, items: items.length, period: used });
    } catch (err) {
      // Leave that meal's existing rows alone; tomorrow's run will retry.
      meals.push({ meal, items: 0, error: (err as Error).message });
      console.error(`menu ingest ${date} ${meal}:`, (err as Error).message);
    }
  }
  return { date, meals };
}

/** Pull `days` dates starting at `start` (YYYY-MM-DD, Toronto), one request at a time. */
export async function ingestRange(start: string, days: number): Promise<IngestReport> {
  const t0 = Date.now();
  const counter = { n: 0 };
  const out: DayReport[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    if (Date.now() - t0 > BUDGET_MS) {
      out.push({ date, meals: INGEST_MEALS.map(({ meal }) => ({ meal, items: 0, error: "skipped: time budget" })) });
      continue;
    }
    out.push(await ingestDate(date, counter));
  }
  const ok = out.every((d) => d.meals.every((m) => !m.error));
  return { ok, days: out, requests: counter.n, ms: Date.now() - t0 };
}
