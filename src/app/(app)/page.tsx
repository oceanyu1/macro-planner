import Link from "next/link";
import {
  addFood,
  adjustHabit,
  clearRejected,
  deleteFood,
  logFavourite,
  planDate,
  rejectPlanItem,
  setGym,
  setTretinoin,
  togglePlanItem,
  toggleTemplateItem,
} from "@/app/actions";
import { Meter, Submit } from "@/components/ui";
import type { MealName } from "@/db/schema";
import { addDays, isValidIsoDate, prettyDate, today, TZ, weekOf } from "@/lib/dates";
import {
  getFavourites,
  getFoodLog,
  getHabit,
  getHabitRange,
  getMenuForDate,
  getMenuItems,
  getPlanLogged,
  getPlans,
  getSettings,
  getTemplate,
  getTemplateLogged,
} from "@/lib/data";
import { gymCountThisWeek, isTretinoinNight, nextGym, streak, tretinoinPhase } from "@/lib/habits";
import { kNaRatio, sumNutrients } from "@/lib/nutrition";
import { dayWarnings, mealTargets, sumTotals, type PlanMeal } from "@/lib/planner";
import { requireUser } from "@/lib/session";

// "Plan this day" / ✕ re-plan inside this page's server actions.
export const maxDuration = 60;

const MEALS: MealName[] = ["breakfast", "lunch", "dinner", "snack"];

function currentMeal(): MealName {
  const h = Number(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date()));
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

export default async function TodayPage({ searchParams }: PageProps<"/">) {
  await requireUser();
  const sp = await searchParams;
  const now = today();
  const date = typeof sp.date === "string" && isValidIsoDate(sp.date) ? sp.date : now;
  const isToday = date === now;

  const [settings, habit, log, favourites, template, templateLogged, history] = await Promise.all([
    getSettings(),
    getHabit(date),
    getFoodLog(date),
    getFavourites(),
    getTemplate(),
    getTemplateLogged(date),
    getHabitRange(addDays(date, -60), date),
  ]);

  const totals = sumNutrients(log);
  const kna = kNaRatio(totals.potassiumMg, totals.sodiumMg);
  const kAllExact = log.length > 0 && log.every((l) => !l.kIsEstimate);
  const historyMap = new Map(history.map((h) => [h.date, h]));
  historyMap.set(date, habit);
  const goals = settings;
  const tretNight = isTretinoinNight(date, settings.tretinoinStart);
  const gymWeek = gymCountThisWeek(history, date);
  const suggestedGym = nextGym(history.filter((h) => h.date < date));
  const meal = isToday ? currentMeal() : "snack";
  const loggedKey = new Set(templateLogged.map((t) => `${t.meal}|${t.name}`));
  const weekDays = weekOf(date);

  // Dining mode: the day's plan, the dishes in it, and what's been ticked off.
  const dining = settings.mode === "dining";
  const [plans, planLogged] = dining ? await Promise.all([getPlans(date), getPlanLogged(date)]) : [[], []];
  const planItems = new Map(
    (await getMenuItems([...new Set(plans.flatMap((p) => p.items.map((i) => i.itemId)))])).map((i) => [i.id, i]),
  );
  const planFor = (m: MealName) => plans.find((p) => p.meal === m);
  const ticked = new Set(planLogged.map((l) => `${l.meal}|${l.menuItemId}`));
  // Only worth checking the menu when there's no plan yet (to offer "Plan this day").
  const hasMenu = plans.length > 0 || (dining && Object.values(await getMenuForDate(date)).some((v) => v.length > 0));
  const { meals: mealBudget, day: dayBudget } = mealTargets(settings);
  const planTotals = sumTotals(plans.map((p) => p.totals ?? { proteinG: 0, calories: 0, sodiumMg: 0, potassiumMg: 0 }));
  const planWarnings = plans.length ? dayWarnings(planTotals, dayBudget) : [];
  // Potassium is read live from the dishes, so Review-screen changes show without re-planning.
  const plannedPicks = plans.flatMap((p) => p.items);
  const planK = plannedPicks.reduce((a, i) => a + (planItems.get(i.itemId)?.kMgEst ?? 0) * i.servings, 0);
  const planKUnknown = plannedPicks.filter((i) => planItems.get(i.itemId)?.kMgEst == null).length;

  return (
    <div className="space-y-4">
      {/* header */}
      <header className="flex items-center justify-between">
        <Link href={`/?date=${addDays(date, -1)}`} className="btn w-10" aria-label="Previous day">
          ‹
        </Link>
        <div className="text-center">
          <h1 className="text-lg font-semibold">{isToday ? "Today" : prettyDate(date)}</h1>
          <p className="text-xs text-muted">
            {isToday ? prettyDate(date) : <Link href="/" className="text-accent">Back to today</Link>} ·{" "}
            {settings.mode === "home" ? "Home mode" : "Dining hall"}
          </p>
        </div>
        <Link href={`/?date=${addDays(date, 1)}`} className="btn w-10" aria-label="Next day">
          ›
        </Link>
      </header>

      {/* nutrition totals */}
      <section className="card space-y-3">
        <Meter
          label="Protein"
          value={totals.proteinG}
          target={settings.proteinTargetG}
          unit="g"
        />
        <Meter
          label="Calories"
          value={totals.calories}
          target={settings.calorieTarget}
          unit="kcal"
          kind="cap"
          hint={`Aim ${settings.calorieTarget - settings.calorieTolerance}–${settings.calorieTarget + settings.calorieTolerance}`}
        />
        <Meter label="Sodium" value={totals.sodiumMg} target={settings.sodiumCapMg} unit="mg" kind="cap" />
        <Meter
          label="Potassium"
          value={totals.potassiumMg}
          target={settings.potassiumGoalMg}
          unit="mg"
          estimate={!kAllExact}
        />
        <p className="text-sm">
          K:Na{" "}
          <span className={`font-semibold tabular-nums ${kAllExact ? "" : "text-est"}`}>
            {kna == null ? "–" : `${kAllExact ? "" : "~"}${kna}`}
          </span>
          <span className="text-muted">
            {" "}
            · goal {(settings.potassiumGoalMg / settings.sodiumCapMg).toFixed(2)}+
          </span>
        </p>
      </section>

      {/* dining mode: the day's plan */}
      {dining && (
        <section className="card space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="h2">Plan</h2>
            {plans.length > 0 && (
              <span className="text-xs tabular-nums text-muted">
                {Math.round(planTotals.proteinG)} g · {planTotals.calories} kcal · {planTotals.sodiumMg} mg Na ·{" "}
                <span className="text-est">
                  ~{Math.round(planK)} mg K{planKUnknown > 0 && ` (+${planKUnknown} ?)`}
                </span>
              </span>
            )}
          </div>
          {plans.length > 0 ? (
            <>
              <p className="text-xs text-muted">
                Meals aim for {Math.round(dayBudget.proteinG)} g protein, {Math.round(dayBudget.caloriesMin)}–
                {Math.round(dayBudget.caloriesMax)} kcal and under {Math.round(dayBudget.sodiumMg)} mg sodium. The
                rest is your {settings.proteinSplit.snack} g snack.
              </p>
              {planWarnings.length > 0 ? (
                <ul className="space-y-1 text-sm text-warn">
                  {planWarnings.map((w) => (
                    <li key={w}>⚠ {w}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-good">✓ On target</p>
              )}
              <form action={planDate.bind(null, date)}>
                <Submit className="btn w-full text-sm">Re-plan day</Submit>
              </form>
            </>
          ) : hasMenu ? (
            <form action={planDate.bind(null, date)}>
              <Submit className="btn-primary w-full">Plan this day</Submit>
            </form>
          ) : (
            <p className="text-sm text-muted">
              No menu for this date yet. Menus are pulled nightly for the next 7 days, or use Settings → Pull menu now.
            </p>
          )}
        </section>
      )}

      {/* meals */}
      {MEALS.map((m) => {
        const items = log.filter((l) => l.meal === m);
        const tmpl = settings.mode === "home" ? template.filter((t) => t.meal === m) : [];
        const mealPlan = dining ? planFor(m) : undefined;
        const mealTotals = sumNutrients(items);
        const split = settings.proteinSplit[m] ?? 0;
        if (!items.length && !tmpl.length && !mealPlan && m === "snack") return null;
        return (
          <section key={m} className="card">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="h2">{m}</h2>
              <span className="text-xs tabular-nums text-muted">
                {Math.round(mealTotals.proteinG)} / {split} g protein
                {mealPlan?.totals && ` · plan ${Math.round(mealPlan.totals.proteinG)} g`}
              </span>
            </div>

            {mealPlan && m !== "snack" && (
              <div className="mb-2 space-y-1">
                {mealPlan.items.length === 0 && <p className="text-sm text-muted">Nothing on the menu fits.</p>}
                <ul className="space-y-1">
                  {mealPlan.items.map((pi) => {
                    const it = planItems.get(pi.itemId);
                    if (!it) return null;
                    const eaten = ticked.has(`${m}|${pi.itemId}`);
                    const n = pi.servings;
                    return (
                      <li key={pi.itemId} className="flex items-stretch gap-1">
                        <form action={togglePlanItem.bind(null, date, m, pi.itemId)} className="flex-1">
                          <Submit
                            className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition active:scale-[0.99] ${eaten ? "border-good/40 bg-good/10" : "border-line"}`}
                          >
                            <span
                              className={`grid size-5 shrink-0 place-items-center rounded-full border text-xs ${eaten ? "border-good bg-good text-white" : "border-muted"}`}
                            >
                              {eaten ? "✓" : ""}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block">
                                {it.name}
                                {n !== 1 && <span className="text-muted"> ×{n}</span>}
                              </span>
                              <span className="block text-xs text-muted">
                                {n !== 1 ? `${n} × ` : ""}
                                {it.servingSize} · {it.station}
                              </span>
                            </span>
                            <span className="text-right text-xs tabular-nums text-muted">
                              {Math.round((it.proteinG ?? 0) * n * 10) / 10}g
                              <br />
                              {Math.round((it.calories ?? 0) * n)} kcal · {Math.round((it.sodiumMg ?? 0) * n)}mg Na ·{" "}
                              <span className="text-est">{it.kMgEst == null ? "?" : `~${it.kMgEst * n}`}K</span>
                            </span>
                          </Submit>
                        </form>
                        {!mealPlan.locked && (
                          <form action={rejectPlanItem.bind(null, date, m, it.sourceId)}>
                            <Submit className="h-full px-2 text-muted" aria-label={`Not ${it.name}, re-plan`}>
                              ✕
                            </Submit>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {mealPlan.reason && <p className="text-xs text-warn">{mealPlan.reason}</p>}
                <p className="flex items-center gap-2 text-xs text-muted">
                  {mealPlan.locked
                    ? "Locked: you've started this meal. Untick everything to re-plan it."
                    : `✕ swaps a dish. Aim ${Math.round(mealBudget[m as PlanMeal].proteinG)} g.`}
                  {mealPlan.rejected.length > 0 && (
                    <form action={clearRejected.bind(null, date, m)} className="inline">
                      <Submit className="text-accent">Bring back {mealPlan.rejected.length} skipped</Submit>
                    </form>
                  )}
                </p>
              </div>
            )}

            {tmpl.length > 0 && (
              <ul className="mb-2 space-y-1">
                {tmpl.map((t) => {
                  const eaten = loggedKey.has(`${t.meal}|${t.name}`);
                  return (
                    <li key={t.id}>
                      <form action={toggleTemplateItem.bind(null, date, t.id)}>
                        <Submit
                          className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition active:scale-[0.99] ${eaten ? "border-good/40 bg-good/10" : "border-line"}`}
                        >
                          <span
                            className={`grid size-5 shrink-0 place-items-center rounded-full border text-xs ${eaten ? "border-good bg-good text-white" : "border-muted"}`}
                          >
                            {eaten ? "✓" : ""}
                          </span>
                          <span className="flex-1">
                            {t.name}
                            {t.servings !== 1 && <span className="text-muted"> ×{t.servings}</span>}
                          </span>
                          <span className="text-xs tabular-nums text-muted">
                            {t.proteinG}g · {t.sodiumMg}mg Na · <span className="text-est">~{t.potassiumMg}K</span>
                          </span>
                        </Submit>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}

            {items.filter((i) => i.source !== "template" && i.source !== "plan").length > 0 && (
              <ul className="divide-y divide-line text-sm">
                {items
                  .filter((i) => i.source !== "template" && i.source !== "plan")
                  .map((i) => (
                    <li key={i.id} className="flex items-center gap-2 py-1.5">
                      <span className="flex-1">
                        {i.name}
                        {i.servings !== 1 && <span className="text-muted"> ×{i.servings}</span>}
                      </span>
                      <span className="text-xs tabular-nums text-muted">
                        {Math.round(i.proteinG * 10) / 10}g · {i.calories} kcal · {i.sodiumMg}mg Na ·{" "}
                        <span className={i.kIsEstimate ? "text-est" : ""}>
                          {i.kIsEstimate ? "~" : ""}
                          {i.potassiumMg}K
                        </span>
                      </span>
                      <form action={deleteFood.bind(null, i.id)}>
                        <Submit className="px-1 text-muted" aria-label={`Remove ${i.name}`}>
                          ✕
                        </Submit>
                      </form>
                    </li>
                  ))}
              </ul>
            )}

            {!items.length && !tmpl.length && !mealPlan && (
              <p className="text-sm text-muted">
                {settings.mode === "home" ? "Nothing logged. Add a home template in Settings." : m === "snack" ? "Bring your own: protein shake, yogurt, etc." : "No plan for this meal yet."}
              </p>
            )}
          </section>
        );
      })}

      {/* quick add */}
      <section className="card space-y-3">
        <h2 className="h2">Quick add</h2>
        {favourites.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {favourites.map((f) => (
              <form key={f.id} action={logFavourite.bind(null, date, meal, f.id)}>
                <Submit className="btn rounded-full text-xs">
                  + {f.name} <span className="ml-1 text-muted">{f.proteinG}g</span>
                </Submit>
              </form>
            ))}
          </div>
        )}
        <details>
          <summary className="cursor-pointer text-sm text-accent">Custom food…</summary>
          <form action={addFood} className="mt-3 grid grid-cols-2 gap-2">
            <input type="hidden" name="date" value={date} />
            <label className="col-span-2">
              <span className="label">Name</span>
              <input name="name" required className="field" placeholder="Banana" />
            </label>
            <label>
              <span className="label">Meal</span>
              <select name="meal" defaultValue={meal} className="field">
                {MEALS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Servings</span>
              <input name="servings" type="number" step="0.25" min="0.25" defaultValue="1" className="field" />
            </label>
            {(
              [
                ["proteinG", "Protein (g)"],
                ["calories", "Calories"],
                ["sodiumMg", "Sodium (mg)"],
                ["potassiumMg", "Potassium (mg)"],
              ] as const
            ).map(([n, l]) => (
              <label key={n}>
                <span className="label">{l} / serving</span>
                <input name={n} type="number" step="any" min="0" inputMode="decimal" className="field" />
              </label>
            ))}
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" name="kExact" /> Potassium is exact (from a label)
            </label>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" name="saveFavourite" /> Save as favourite
            </label>
            <Submit className="btn-primary col-span-2">Add</Submit>
          </form>
        </details>
      </section>

      {/* habits */}
      <section className="card space-y-4">
        <h2 className="h2">Habits</h2>

        <HabitCounter
          label="Water"
          value={`${(habit.waterMl / 1000).toFixed(2)} / ${(goals.waterGoalMl / 1000).toFixed(1)} L`}
          done={habit.waterMl >= goals.waterGoalMl}
          streakDays={streak("water", historyMap, goals, date)}
        >
          <form action={adjustHabit.bind(null, date, "waterMl", -250)}>
            <Submit>−250</Submit>
          </form>
          <form action={adjustHabit.bind(null, date, "waterMl", 250)}>
            <Submit>+250</Submit>
          </form>
          <form action={adjustHabit.bind(null, date, "waterMl", 500)}>
            <Submit className="btn-primary">+500</Submit>
          </form>
        </HabitCounter>

        <HabitCounter
          label="Neck sets"
          value={`${habit.neckSets} / ${goals.neckSetsGoal}`}
          done={habit.neckSets >= goals.neckSetsGoal}
          streakDays={streak("neck", historyMap, goals, date)}
        >
          <form action={adjustHabit.bind(null, date, "neckSets", -1)}>
            <Submit className="btn w-10">−</Submit>
          </form>
          <form action={adjustHabit.bind(null, date, "neckSets", 1)}>
            <Submit className="btn-primary w-10">+</Submit>
          </form>
        </HabitCounter>

        <HabitCounter
          label="LeetCode"
          value={`${habit.leetcode} / ${goals.leetcodeGoal}`}
          done={habit.leetcode >= goals.leetcodeGoal}
          streakDays={streak("leetcode", historyMap, goals, date)}
        >
          <form action={adjustHabit.bind(null, date, "leetcode", -1)}>
            <Submit className="btn w-10">−</Submit>
          </form>
          <form action={adjustHabit.bind(null, date, "leetcode", 1)}>
            <Submit className="btn-primary w-10">+</Submit>
          </form>
        </HabitCounter>

        <div>
          <div className="flex items-baseline justify-between">
            <span className="font-medium">Gym</span>
            <span className="text-xs text-muted">
              {gymWeek} / {goals.gymPerWeek} this week{!habit.gym && ` · next: ${suggestedGym}`}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(["upper", "lower", null] as const).map((g) => {
              const active = habit.gym === g;
              return (
                <form key={g ?? "rest"} action={setGym.bind(null, date, g)}>
                  <Submit
                    className={`btn w-full capitalize ${active ? (g ? "border-good bg-good/15 text-good" : "border-accent text-accent") : ""} ${!habit.gym && g === suggestedGym ? "border-dashed border-accent" : ""}`}
                  >
                    {g ?? "rest"}
                  </Submit>
                </form>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <span className="font-medium">Tretinoin</span>
            <p className="text-xs text-muted">
              {settings.tretinoinStart
                ? `${tretinoinPhase(date, settings.tretinoinStart)} · ${tretNight ? "tonight's a night" : "off tonight"}`
                : "Set a start date in Settings"}
            </p>
          </div>
          {tretNight && (
            <form action={setTretinoin.bind(null, date, !habit.tretinoin)}>
              <Submit className={habit.tretinoin ? "btn border-good bg-good/15 text-good" : "btn-primary"}>
                {habit.tretinoin ? "✓ Done" : "Mark done"}
              </Submit>
            </form>
          )}
        </div>
      </section>

      <p className="text-center text-xs text-muted">
        Week of {prettyDate(weekDays[0])} · <Link href="/week" className="text-accent">see week</Link>
      </p>
    </div>
  );
}

function HabitCounter({
  label,
  value,
  done,
  streakDays,
  children,
}: {
  label: string;
  value: string;
  done: boolean;
  streakDays: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <span className="font-medium">
          {done && <span className="text-good">✓ </span>}
          {label}
        </span>
        <p className="text-xs tabular-nums text-muted">
          {value}
          {streakDays > 0 && ` · ${streakDays}d streak`}
        </p>
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}
