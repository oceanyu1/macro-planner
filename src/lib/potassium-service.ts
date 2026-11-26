import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { kMapping, menuItem } from "@/db/schema";
import { autoMatch, cnfByCode, potassiumKey, servingPotassium } from "./potassium";

/**
 * Give every menu item a potassium estimate:
 *  1. Each dish name without a k_mapping row gets one from the best CNF match
 *     (confirmed = false, so it shows up on the Review screen).
 *  2. Every item's k_mg_est = mapping mg/100 g × serving grams, or null when
 *     there's no match or the serving has no weight ("1 each").
 * Cheap enough to run on every ingest: a few hundred rows, one UPDATE.
 */
export async function estimateMenuPotassium(): Promise<{ newMatches: number; rematched: number; updated: number }> {
  const [items, maps] = await Promise.all([
    db
      .select({
        id: menuItem.id,
        name: menuItem.name,
        kind: menuItem.kind,
        ingredients: menuItem.ingredients,
        servingAmount: menuItem.servingAmount,
        servingUnit: menuItem.servingUnit,
        kMgEst: menuItem.kMgEst,
        kSource: menuItem.kSource,
      })
      .from(menuItem),
    db.select().from(kMapping),
  ]);

  const byKey = new Map(maps.map((m) => [m.ingredientText, m]));
  const fresh: (typeof kMapping.$inferInsert)[] = [];
  const rematched: (typeof kMapping.$inferInsert)[] = [];
  const handled = new Set<string>();
  for (const it of items) {
    const key = potassiumKey(it.name);
    if (!key || handled.has(key)) continue;
    handled.add(key);
    const existing = byKey.get(key);
    if (existing?.confirmed) continue; // someone chose this one: leave it
    const m = autoMatch(it);
    const row = { ingredientText: key, foodCode: m?.code ?? null, foodName: m?.name ?? null, mgPer100g: m?.mgPer100g ?? null, confirmed: false };
    if (!existing) fresh.push(row);
    else if (existing.foodCode !== row.foodCode) rematched.push(row); // matcher improved since last run
  }
  if (fresh.length) {
    const inserted = await db.insert(kMapping).values(fresh).onConflictDoNothing().returning();
    for (const m of inserted) byKey.set(m.ingredientText, m);
  }
  for (const r of rematched) {
    const [m] = await db
      .update(kMapping)
      .set({ foodCode: r.foodCode, foodName: r.foodName, mgPer100g: r.mgPer100g })
      .where(eq(kMapping.ingredientText, r.ingredientText))
      .returning();
    if (m) byKey.set(m.ingredientText, m);
  }

  const changes: { id: number; k: number | null; src: "cnf" | null }[] = [];
  for (const it of items) {
    const m = byKey.get(potassiumKey(it.name));
    const k = servingPotassium(m?.mgPer100g ?? null, it.servingAmount, it.servingUnit);
    const src = k == null ? null : "cnf";
    if (k !== it.kMgEst || src !== it.kSource) changes.push({ id: it.id, k, src });
  }
  if (changes.length) {
    await db.execute(sql`
      update menu_item as m
      set k_mg_est = v.k, k_source = v.src::k_source, updated_at = now()
      from (values ${sql.join(
        changes.map((c) => sql`(${c.id}::int, ${c.k}::int, ${c.src}::text)`),
        sql`, `,
      )}) as v(id, k, src)
      where m.id = v.id`);
  }
  return { newMatches: fresh.length, rematched: rematched.length, updated: changes.length };
}

/** Review screen: point a dish at another CNF food (or none) and mark it confirmed. */
export async function setPotassiumMatch(key: string, foodCode: number | null): Promise<void> {
  const food = foodCode == null ? null : cnfByCode(foodCode);
  if (foodCode != null && !food) throw new Error(`unknown CNF food ${foodCode}`);
  await db
    .insert(kMapping)
    .values({
      ingredientText: key,
      foodCode: food?.code ?? null,
      foodName: food?.name ?? null,
      mgPer100g: food?.mgPer100g ?? null,
      confirmed: true,
    })
    .onConflictDoUpdate({
      target: kMapping.ingredientText,
      set: {
        foodCode: food?.code ?? null,
        foodName: food?.name ?? null,
        mgPer100g: food?.mgPer100g ?? null,
        confirmed: true,
      },
    });
  await estimateMenuPotassium();
}

export async function confirmPotassiumMatches(keys: string[] | "all"): Promise<void> {
  if (keys === "all") await db.update(kMapping).set({ confirmed: true }).where(eq(kMapping.confirmed, false));
  else for (const k of keys) await db.update(kMapping).set({ confirmed: true }).where(eq(kMapping.ingredientText, k));
}
