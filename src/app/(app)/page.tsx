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
  skipMeal,
  toggleMilestone,
  togglePlanItem,
  toggleTemplateItem,
} from "@/app/actions";
import { Icon, Tick } from "@/components/icons";
import { Bar, Ring, Submit } from "@/components/ui";
import type { MealName } from "@/db/schema";
import { addDays, isValidIsoDate, prettyDate, today, TZ, weekOf } from "@/lib/dates";
import {
  getFavourites,
  getFoodLog,
  getHabit,
  getHabitRange,
  getMenuForDate,
  getMenuItems,
  getMilestones,
  getPlanLogged,
  getPlans,
  getSettings,
  getTemplate,
  getTemplateLogged,
} from "@/lib/data";
import { gymCountThisWeek, isTretinoinNight, nextGym, streak, tretinoinPhase } from "@/lib/habits";
import { dishName, servingLabel } from "@/lib/menu/display";
import { kNaRatio, sumNutrients } from "@/lib/nutrition";
import { dayWarnings, mealTargets, PLAN_MEALS, sumTotals, type PlanMeal } from "@/lib/planner";
import { getTodaysRead, type DailyRead } from "@/lib/reading";
import { requireUser } from "@/lib/session";

// "Plan this day", "Re-plan day" and "Skipped this meal" ask Claude (up to 3 attempts) inside this page's actions.
export const maxDuration = 150;

/*
 * Layout: phone = one column.
 * Two halves. Your day: [read | progress ring], then habit tiles (+ Goals due).
 * Nutrition (divided, own heading): [eaten | plan], [breakfast | lunch | dinner], snack strip.
 * Phone order: header, progress, read, habits, nutrition.
 * Same DOM for both; `lg:` classes rearrange it.
 *
 * Design rules (unslop pass, 2026-11-25): 4 px grid, cards p-5 + rounded-2xl,
 * controls rounded-[10px]; weights 400/500 with 600 only on the page title;
 * the accent only on the ring, the primary action in a card, ticks and the
 * active tab; colour otherwise lives in the nutrition bars; the round <Tick>
 * is the one "done" mark; short lines end without a period.
 */

const MEALS: MealName[] = ["breakfast", "lunch", "dinner", "snack"];
const MEAL_LABEL: Record<MealName, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

function currentMeal(): MealName {
  const h = Number(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date()));
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

/** One number format: whole units with thousands separators. */
const fmt = (n: number) => Math.round(n).toLocaleString("en-CA");
/** Short lines (captions, notes, warnings) end without a period. */
const bare = (s: string) => s.trim().replace(/\.$/, "");
const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

const quietSmall =
  "min-h-11 text-[13px] font-medium text-secondary transition-colors hover:text-foreground disabled:opacity-60 lg:min-h-8";
const quietAction =
  "min-h-11 text-[15px] font-medium text-secondary transition-colors hover:text-foreground disabled:opacity-60";
const primaryAction =
  "h-12 w-full rounded-[10px] bg-accent text-[17px] font-medium text-white transition-[transform,opacity] active:scale-[0.98] disabled:opacity-60 lg:h-10 lg:w-auto lg:px-4 lg:text-[15px]";

export default async function TodayPage({ searchParams }: PageProps<"/">) {
  await requireUser();
  const sp = await searchParams;
  const now = today();
  const date = typeof sp.date === "string" && isValidIsoDate(sp.date) ? sp.date : now;
  const isToday = date === now;

  const [settings, habit, log, favourites, template, templateLogged, history, read, milestones] = await Promise.all([
    getSettings(),
    getHabit(date),
    getFoodLog(date),
    getFavourites(),
    getTemplate(),
    getTemplateLogged(date),
    getHabitRange(addDays(date, -60), date),
    getTodaysRead(date),
    getMilestones(),
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
  const skippedMeals = plans.filter((p) => p.skipped && p.meal !== "snack").map((p) => p.meal as PlanMeal);
  const { day: dayBudget } = mealTargets(settings, skippedMeals);
  const aiPlan = plans.some((p) => p.generator === "llm");
  const planTotals = sumTotals(plans.map((p) => p.totals ?? { proteinG: 0, calories: 0, sodiumMg: 0, potassiumMg: 0 }));
  const planWarnings = plans.length ? dayWarnings(planTotals, dayBudget) : [];
  // Potassium is read live from the dishes, so Review-screen changes show without re-planning.
  const plannedPicks = plans.flatMap((p) => p.items);
  const planK = plannedPicks.reduce((a, i) => a + (planItems.get(i.itemId)?.kMgEst ?? 0) * i.servings, 0);
  const planKUnknown = plannedPicks.filter((i) => planItems.get(i.itemId)?.kMgEst == null).length;

  // Hero: protein eaten, what's left, and the next meal with planned protein still to eat.
  const proteinLeft = Math.max(0, settings.proteinTargetG - totals.proteinG);
  const eatenIn = (m: MealName) => sumNutrients(log.filter((l) => l.meal === m)).proteinG;
  const nextMeal = dining
    ? PLAN_MEALS.map((m) => ({ m, left: (planFor(m)?.totals?.proteinG ?? 0) - eatenIn(m) })).find(
        (x) => !planFor(x.m)?.skipped && x.left > 0.5,
      )
    : undefined;
  const calMax = settings.calorieTarget + settings.calorieTolerance;
  const calMin = settings.calorieTarget - settings.calorieTolerance;
  const calOver = totals.calories > calMax;
  const naOver = totals.sodiumMg > settings.sodiumCapMg;

  /** One meal as one card: title and protein, dish rows, then Claude's note, sodium/potassium and the meal's actions. */
  const mealCard = (m: PlanMeal) => {
    const items = log.filter((l) => l.meal === m);
    const extras = items.filter((i) => i.source !== "template" && i.source !== "plan");
    const tmpl = settings.mode === "home" ? template.filter((t) => t.meal === m) : [];
    const mealPlan = dining ? planFor(m) : undefined;
    const eaten = sumNutrients(items).proteinG;
    const split = settings.proteinSplit[m] ?? 0;
    const planned = mealPlan?.totals?.proteinG ?? 0;
    const showPlan = mealPlan && !mealPlan.skipped;
    const progress = mealPlan?.skipped
      ? "Skipped"
      : eaten > 0
        ? `${fmt(eaten)} of ${fmt(showPlan ? planned : split)} g`
        : showPlan
          ? `${fmt(planned)} g`
          : `${split} g goal`;
    const rows = (showPlan ? mealPlan.items.length : 0) + tmpl.length + extras.length;
    const picks = showPlan ? mealPlan.items.map((pi) => ({ pi, it: planItems.get(pi.itemId) })) : [];
    const mealNa = picks.reduce((a, { pi, it }) => a + (it?.sodiumMg ?? 0) * pi.servings, 0);
    const mealK = picks.reduce((a, { pi, it }) => a + (it?.kMgEst ?? 0) * pi.servings, 0);

    return (
      <section key={m} aria-label={MEAL_LABEL[m]} className="flex min-w-0 flex-col overflow-hidden rounded-2xl bg-card lg:flex-1">
        <div className="flex items-baseline justify-between gap-3 px-5 pt-5 pb-2">
          <h2 className="text-xl leading-7 font-medium">{MEAL_LABEL[m]}</h2>
          <span className="text-[15px] leading-5 text-muted tabular-nums">{progress}</span>
        </div>

        {mealPlan?.skipped && (
          <div className="flex flex-1 items-center justify-between gap-3 px-5 pb-4">
            <span className="text-[15px] leading-5 text-muted">Its share moved to your other meals</span>
            <form action={skipMeal.bind(null, date, m, false)}>
              <Submit className={quietAction} pendingLabel="Re-planning…">
                Undo
              </Submit>
            </form>
          </div>
        )}

        {rows > 0 && (
          <ul className="pb-2">
            {picks.map(({ pi, it }) =>
              it ? (
                <DishRow
                  key={`p${pi.itemId}`}
                  tick={togglePlanItem.bind(null, date, m, pi.itemId)}
                  done={ticked.has(`${m}|${pi.itemId}`)}
                  name={dishName(it.name)}
                  times={pi.servings}
                  meta={`${pi.servings !== 1 ? `${pi.servings} × ` : ""}${servingLabel(it.servingSize)} · ${it.station ?? ""}`}
                  protein={(it.proteinG ?? 0) * pi.servings}
                  remove={mealPlan?.locked ? undefined : rejectPlanItem.bind(null, date, m, it.sourceId)}
                  removeLabel={`Swap out ${dishName(it.name)}`}
                />
              ) : null,
            )}
            {tmpl.map((t) => (
              <DishRow
                key={`t${t.id}`}
                tick={toggleTemplateItem.bind(null, date, t.id)}
                done={loggedKey.has(`${t.meal}|${t.name}`)}
                name={t.name}
                times={t.servings}
                meta={`Home template · ${fmt(t.sodiumMg)} mg Na`}
                protein={t.proteinG}
              />
            ))}
            {extras.map((i) => (
              <DishRow
                key={`l${i.id}`}
                name={i.name}
                times={i.servings}
                meta={`Logged · ${fmt(i.calories)} kcal · ${fmt(i.sodiumMg)} mg Na`}
                protein={i.proteinG}
                remove={deleteFood.bind(null, i.id)}
                removeLabel={`Remove ${i.name}`}
              />
            ))}
          </ul>
        )}

        {rows === 0 && !mealPlan?.skipped && (
          <p className="px-5 pb-5 text-[15px] leading-5 text-muted">
            {dining ? "No plan for this meal yet" : "Nothing logged yet · add a home template in Settings"}
          </p>
        )}

        {showPlan && (
          <div className="mt-auto flex flex-col gap-2 border-t border-line px-5 pt-3 pb-2">
            {mealPlan.reason && (
              <p className={`text-[13px] leading-5 ${mealPlan.generator === "llm" ? "text-muted" : "text-warn"}`}>
                {bare(mealPlan.reason)}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-4">
              <span className="text-[13px] leading-5 text-muted tabular-nums">
                {fmt(mealNa)} mg Na · <span className="text-est">~{fmt(mealK)} mg K</span>
              </span>
              <div className="flex items-center gap-4">
                {mealPlan.rejected.length > 0 && (
                  <form action={clearRejected.bind(null, date, m)}>
                    <Submit className={quietSmall}>Bring back {mealPlan.rejected.length}</Submit>
                  </form>
                )}
                {mealPlan.locked ? (
                  <span className="text-[13px] leading-5 text-muted">Started</span>
                ) : (
                  <form action={skipMeal.bind(null, date, m, true)}>
                    <Submit className={quietSmall} pendingLabel="Re-planning…">
                      Skip meal
                    </Submit>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    );
  };

  /** Snack: one strip. What's logged, favourites to log in one tap, and the custom food form. */
  const snackItems = log.filter((l) => l.meal === "snack");
  const snackTmpl = settings.mode === "home" ? template.filter((t) => t.meal === "snack") : [];
  const snackEaten = sumNutrients(snackItems).proteinG;
  const chip = "inline-flex min-h-10 items-center gap-2 rounded-[10px] bg-background px-3 text-[15px] leading-5";

  const snackStrip = (
    <section aria-label="Snack" className="card flex flex-wrap items-center gap-x-6 gap-y-3 lg:py-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-xl leading-7 font-medium">Snack</h2>
        <span className="text-[15px] leading-5 text-muted tabular-nums">
          {fmt(snackEaten)} of {settings.proteinSplit.snack ?? 0} g
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {snackItems
          .filter((i) => i.source !== "template")
          .map((i) => (
            <span key={i.id} className={`${chip} pr-1`}>
              <Tick done size={20} />
              {i.name} <span className="text-muted tabular-nums">{fmt(i.proteinG)} g</span>
              <form action={deleteFood.bind(null, i.id)}>
                <Submit
                  aria-label={`Remove ${i.name}`}
                  className="flex size-8 items-center justify-center rounded-full text-control transition-colors hover:text-secondary"
                >
                  <Icon.x />
                </Submit>
              </form>
            </span>
          ))}
        {snackTmpl.map((t) => (
          <form key={t.id} action={toggleTemplateItem.bind(null, date, t.id)}>
            <Submit className={chip}>
              <Tick done={loggedKey.has(`${t.meal}|${t.name}`)} size={20} />
              {t.name} <span className="text-muted tabular-nums">{fmt(t.proteinG)} g</span>
            </Submit>
          </form>
        ))}
        {favourites.map((f) => (
          <form key={f.id} action={logFavourite.bind(null, date, "snack", f.id)}>
            <Submit aria-label={`Log ${f.name}`} className={`${chip} transition-[transform,background-color] active:scale-[0.98]`}>
              <span className="text-muted">
                <Icon.plus />
              </span>
              {f.name} <span className="text-muted tabular-nums">{fmt(f.proteinG)} g</span>
            </Submit>
          </form>
        ))}
        {!snackItems.length && !favourites.length && !snackTmpl.length && (
          <span className="text-[15px] leading-5 text-muted">Bring your own</span>
        )}
        <details className="open:basis-full">
          <summary className={`${chip} cursor-pointer list-none font-medium text-secondary`}>
            <Icon.plus />
            Custom food
          </summary>
          <CustomFoodForm date={date} meal={meal} />
        </details>
      </div>
    </section>
  );

  /**
   * Today's progress: every non-nutrition goal for the day, done or not.
   * Gym counts as done once it's logged today, or once the week's gym goal is met.
   * Goals milestones count when due today or overdue (or finished today).
   */
  const dueLabel = (due: string) => (due < date ? "overdue" : "due today");
  const dueMilestones = milestones
    .filter((ms) => (!ms.done && ms.dueDate && ms.dueDate <= date) || (ms.done && ms.doneAt === date))
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  const progressGoals: ProgressGoal[] = [
    { key: "water", label: "Water", done: habit.waterMl >= goals.waterGoalMl },
    { key: "neck", label: "Neck sets", done: habit.neckSets >= goals.neckSetsGoal },
    { key: "leetcode", label: "LeetCode", done: habit.leetcode >= goals.leetcodeGoal },
    { key: "gym", label: "Gym", done: !!habit.gym || gymWeek >= goals.gymPerWeek },
    ...(tretNight ? [{ key: "tretinoin", label: "Tretinoin", done: habit.tretinoin }] : []),
    ...dueMilestones.map((ms) => ({ key: `ms${ms.id}`, label: ms.title, done: ms.done })),
  ];

  return (
    <div className="flex flex-col gap-8 lg:gap-6">
      {/* header */}
      <header className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[13px] leading-5 font-medium text-muted">
            {longDate(date)} · {dining ? "Dining hall" : "Home"}
          </p>
          <h1 className="text-[34px] leading-10 font-semibold">{isToday ? "Today" : prettyDate(date)}</h1>
          {!isToday && (
            <Link href="/" className="text-[15px] font-medium text-secondary transition-colors hover:text-foreground">
              Back to today
            </Link>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            href={`/?date=${addDays(date, -1)}`}
            aria-label="Previous day"
            className="flex size-11 items-center justify-center rounded-full bg-card text-secondary transition-colors hover:text-foreground"
          >
            <Icon.chevronLeft />
          </Link>
          <Link
            href={`/?date=${addDays(date, 1)}`}
            aria-label="Next day"
            className="flex size-11 items-center justify-center rounded-full bg-card text-secondary transition-colors hover:text-foreground"
          >
            <Icon.chevronRight />
          </Link>
        </div>
      </header>

      {/* your day: today's read (laptop: left, wide) + progress on every non-nutrition goal */}
      <div className="flex flex-col gap-8 lg:flex-row lg:items-stretch lg:gap-6">
        <ProgressCard goals={progressGoals} className="lg:min-w-0 lg:flex-[1_1_320px]" />
        <ReadCard read={read} className="lg:order-first lg:min-w-0 lg:flex-[2_1_520px]" />
      </div>

      <section aria-label="Habits" className="flex min-w-0 flex-col gap-3">
        <h2 className="section-title px-1">Habits</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
          <div className="col-span-2 flex flex-col gap-3 rounded-2xl bg-card p-5 lg:col-span-1">
            <TileHead label="Water" done={habit.waterMl >= goals.waterGoalMl} />
            <p className="text-[28px] leading-8 font-medium tabular-nums lg:text-2xl">
              {(habit.waterMl / 1000).toFixed(2)} L{" "}
              <span className="text-[15px] font-normal text-muted lg:text-sm">of {(goals.waterGoalMl / 1000).toFixed(1)} L</span>
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-control"
                style={{ width: `${Math.min(100, (habit.waterMl / Math.max(1, goals.waterGoalMl)) * 100)}%` }}
              />
            </div>
            <StreakText days={streak("water", historyMap, goals, date)} />
            <div className="mt-auto grid grid-cols-3 gap-2">
              <form action={adjustHabit.bind(null, date, "waterMl", -250)}>
                <Submit aria-label="Remove 250 mL of water" className="btn w-full px-1 tabular-nums">
                  −250
                </Submit>
              </form>
              <form action={adjustHabit.bind(null, date, "waterMl", 250)}>
                <Submit aria-label="Add 250 mL of water" className="btn w-full px-1 tabular-nums">
                  +250
                </Submit>
              </form>
              <form action={adjustHabit.bind(null, date, "waterMl", 500)}>
                <Submit aria-label="Add 500 mL of water" className="btn w-full px-1 tabular-nums">
                  +500
                </Submit>
              </form>
            </div>
          </div>

          <CounterTile
            label="Neck sets"
            value={habit.neckSets}
            goal={goals.neckSetsGoal}
            streakDays={streak("neck", historyMap, goals, date)}
            dec={adjustHabit.bind(null, date, "neckSets", -1)}
            inc={adjustHabit.bind(null, date, "neckSets", 1)}
          />
          <CounterTile
            label="LeetCode"
            value={habit.leetcode}
            goal={goals.leetcodeGoal}
            streakDays={streak("leetcode", historyMap, goals, date)}
            dec={adjustHabit.bind(null, date, "leetcode", -1)}
            inc={adjustHabit.bind(null, date, "leetcode", 1)}
          />

          <div className="col-span-2 flex flex-col gap-3 rounded-2xl bg-card p-5 lg:col-span-1">
            <TileHead label="Gym" done={!!habit.gym} />
            <p className="text-[13px] leading-5 text-muted">
              {gymWeek} of {goals.gymPerWeek} this week{!habit.gym && ` · next: ${suggestedGym}`}
            </p>
            <div role="group" aria-label="Today's workout" className="mt-auto grid grid-cols-3 gap-1 rounded-[10px] bg-line p-1">
              {(["upper", "lower", null] as const).map((g) => {
                const selected = g !== null && habit.gym === g;
                return (
                  <form key={g ?? "rest"} action={setGym.bind(null, date, g)}>
                    <Submit
                      aria-pressed={selected}
                      className={`min-h-9 w-full rounded-md text-[15px] capitalize transition-colors lg:text-[13px] ${selected ? "bg-card font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.05)]" : "text-secondary hover:text-foreground"}`}
                    >
                      {g ?? "rest"}
                    </Submit>
                  </form>
                );
              })}
            </div>
          </div>

          <div className="col-span-2 flex flex-col gap-3 rounded-2xl bg-card p-5 lg:col-span-1">
            <TileHead label="Tretinoin" done={tretNight && habit.tretinoin} />
            <p className="text-[13px] leading-5 text-muted">
              {settings.tretinoinStart
                ? `${tretinoinPhase(date, settings.tretinoinStart)} · ${tretNight ? "tonight’s a night" : "off tonight"}`
                : "Set a start date in Settings"}
            </p>
            {tretNight && (
              <form action={setTretinoin.bind(null, date, !habit.tretinoin)} className="mt-auto">
                <Submit
                  aria-pressed={habit.tretinoin}
                  className="btn w-full justify-start gap-3 px-3"
                >
                  <Tick done={habit.tretinoin} size={20} />
                  {habit.tretinoin ? "Done tonight" : "Mark done tonight"}
                </Submit>
              </form>
            )}
          </div>
          {dueMilestones.length > 0 && (
            <div className="col-span-2 flex flex-col gap-3 rounded-2xl bg-card p-5 lg:col-span-1">
              <TileHead label="Goals due" done={dueMilestones.every((ms) => ms.done)} />
              <ul className="-mx-2 flex flex-col">
                {dueMilestones.map((ms) => (
                  <li key={ms.id}>
                    <form action={toggleMilestone.bind(null, ms.id, now)}>
                      <Submit
                        aria-pressed={ms.done}
                        className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-2 text-left transition-colors hover:bg-background"
                      >
                        <Tick done={ms.done} size={20} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[15px] leading-5">{ms.title}</span>
                          <span className="truncate text-[13px] leading-5 text-muted">
                            {ms.project}
                            {!ms.done && ` · ${dueLabel(ms.dueDate!)}`}
                          </span>
                        </span>
                      </Submit>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* nutrition: everything about food, set apart */}
      <section aria-label="Nutrition" className="flex flex-col gap-6 border-t border-line pt-8">
        <h2 className="px-1 text-[28px] leading-9 font-medium">Nutrition</h2>

        <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
        <section aria-label="Eaten so far" className="card flex flex-col gap-6 lg:min-w-0 lg:flex-1">
          <div className="flex items-center gap-5">
            <Ring pct={(totals.proteinG / settings.proteinTargetG) * 100}>
              <span className="text-[28px] leading-8 font-medium tabular-nums">{fmt(totals.proteinG)}</span>
              <span className="text-[13px] leading-5 text-muted">of {settings.proteinTargetG} g</span>
            </Ring>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-[13px] leading-5 font-medium text-muted">Protein</p>
              <p className="text-[22px] leading-7 font-medium">
                {proteinLeft > 0 ? `${fmt(proteinLeft)} g to go` : "Protein done"}
              </p>
              {nextMeal && (
                <p className="text-[15px] leading-5 text-muted">
                  Next up: {nextMeal.m}, {fmt(nextMeal.left)} g planned
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <Bar
              label="Calories"
              value={fmt(totals.calories)}
              of={`of ${fmt(calMin)}–${fmt(calMax)}`}
              pct={(totals.calories / calMax) * 100}
              fill={calOver ? "bg-fill-red" : "bg-fill-green"}
              valueClass={calOver ? "text-bad" : ""}
            />
            <Bar
              label="Sodium"
              value={fmt(totals.sodiumMg)}
              of={`of under ${fmt(settings.sodiumCapMg)} mg`}
              pct={(totals.sodiumMg / settings.sodiumCapMg) * 100}
              fill={naOver ? "bg-fill-red" : "bg-fill-orange"}
              valueClass={naOver ? "text-bad" : ""}
            />
            <Bar
              label="Potassium"
              value={`${kAllExact ? "" : "~"}${fmt(totals.potassiumMg)}`}
              of={`of ${fmt(settings.potassiumGoalMg)} mg`}
              pct={(totals.potassiumMg / settings.potassiumGoalMg) * 100}
              fill="bg-fill-yellow"
              valueClass={kAllExact ? "" : "text-est"}
            />
            <p className="text-[13px] leading-5 text-muted">
              K:Na{" "}
              <span className={`font-medium ${kAllExact ? "text-foreground" : "text-est"}`}>
                {kna == null ? "–" : `${kAllExact ? "" : "~"}${kna}`}
              </span>{" "}
              · goal {(settings.potassiumGoalMg / settings.sodiumCapMg).toFixed(2)} or more
              {!kAllExact && log.length > 0 && " · potassium is an estimate"}
            </p>
          </div>
        </section>


        {/* dining mode: the day's plan */}
        {dining && (
          <section
            aria-label="Plan"
            className="card flex flex-col gap-5 lg:min-w-0 lg:flex-1"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xl leading-7 font-medium">{isToday ? "Today’s plan" : "Plan"}</h2>
              {plans.length > 0 && (
                <span className="text-[13px] leading-5 text-muted">{aiPlan ? "Planned by Claude" : "Quick plan"}</span>
              )}
            </div>
            {plans.length > 0 ? (
              <>
                <div className="grid grid-cols-4 gap-2">
                  <Stat value={`${fmt(planTotals.proteinG)} g`} label="protein" />
                  <Stat value={fmt(planTotals.calories)} label="kcal" />
                  <Stat value={fmt(planTotals.sodiumMg)} label="mg sodium" />
                  <Stat
                    value={`~${fmt(planK)}`}
                    label={planKUnknown ? `mg potassium (+${planKUnknown} ?)` : "mg potassium"}
                    valueClass="text-est"
                  />
                </div>
                {planWarnings.length > 0 ? (
                  <div className="flex items-start gap-3 rounded-xl bg-background px-4 py-3 text-warn">
                    <Icon.alert />
                    <ul className="flex flex-col gap-1 text-[15px] leading-5">
                      {planWarnings.map((w) => (
                        <li key={w}>{bare(w)}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-xl bg-background px-4 py-3">
                    <Tick done />
                    <p className="text-[15px] leading-5">
                      <span className="font-medium">On target</span>
                      <span className="text-muted"> · your {settings.proteinSplit.snack} g snack covers the rest</span>
                    </p>
                  </div>
                )}
                <form action={planDate.bind(null, date)} className="mt-auto">
                  <Submit className={primaryAction} pendingLabel="Planning… (up to a minute)">
                    Re-plan day
                  </Submit>
                </form>
              </>
            ) : hasMenu ? (
              <form action={planDate.bind(null, date)} className="mt-auto">
                <Submit className={primaryAction} pendingLabel="Planning… (up to a minute)">
                  Plan this day
                </Submit>
              </form>
            ) : (
              <p className="text-[15px] leading-5 text-muted">
                No menu for this date yet. Menus are pulled nightly for the next 7 days, or use Settings → Pull menu now.
              </p>
            )}
          </section>
        )}

        </div>

        <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">{PLAN_MEALS.map((m) => mealCard(m))}</div>

        {snackStrip}
      </section>

      <p className="text-center text-[13px] leading-5 text-muted">
        Week of {prettyDate(weekDays[0])} ·{" "}
        <Link href="/week" className="font-medium text-secondary transition-colors hover:text-foreground">
          See week
        </Link>
      </p>
    </div>
  );
}

/* ---------- pieces ---------- */

function ReadCard({ read, className = "" }: { read: DailyRead; className?: string }) {
  return (
    <article aria-label="Today's read" className={`card flex flex-col gap-4 ${className}`}>
      <p className="text-[13px] leading-5 text-muted">
        <span className="font-medium">Today’s read</span> · {read.topic} · ~{read.minutes} min
      </p>
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl leading-8 font-medium lg:text-[28px] lg:leading-9">{read.title}</h2>
        <p className="text-[15px] leading-5 text-muted">
          {read.author} · {read.source}
        </p>
      </div>
      <p className="max-w-[40rem] text-[17px] leading-7 text-secondary">{read.summary}</p>
      {read.lookFor.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[15px] leading-5 font-medium">Look for</span>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[15px] leading-6 text-secondary">
            {read.lookFor.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        <a
          href={read.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-accent px-4 text-[15px] font-medium text-white transition-[transform,opacity] active:scale-[0.98]"
        >
          Read article
          <Icon.external />
        </a>
        {read.placeholder && (
          <span className="text-[13px] leading-5 text-muted">Placeholder pick · daily articles aren’t set up yet</span>
        )}
      </div>
    </article>
  );
}

function Stat({ value, label, valueClass = "" }: { value: string; label: string; valueClass?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className={`text-xl leading-7 font-medium tabular-nums lg:text-[17px] lg:leading-6 ${valueClass}`}>{value}</span>
      <span className="text-xs leading-4 text-muted">{label}</span>
    </div>
  );
}

/** Tile title with the done tick on the right once the habit is met. */
function TileHead({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex h-6 items-center justify-between gap-3">
      <span className="text-[17px] leading-6 font-medium">{label}</span>
      {done && (
        <>
          <Tick done />
          <span className="sr-only">done</span>
        </>
      )}
    </div>
  );
}

function StreakText({ days }: { days: number }) {
  return <span className="text-[13px] leading-5 text-muted">{days > 0 ? `${days}-day streak` : "No streak yet"}</span>;
}

/**
 * One dish row: tick, name and serving on the left, protein on the right.
 * Sodium and potassium live once per meal, in the card's footer. With `remove`,
 * a ✕ swaps the dish out (on laptop it shows on hover or keyboard focus).
 */
function DishRow({
  tick,
  done = false,
  name,
  times,
  meta,
  protein,
  remove,
  removeLabel,
}: {
  tick?: () => Promise<void>;
  done?: boolean;
  name: string;
  times: number;
  meta: string;
  protein: number;
  remove?: () => Promise<void>;
  removeLabel?: string;
}) {
  const body = (
    <>
      {tick && <Tick done={done} />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] leading-5">
          {name}
          {times !== 1 && <span className="text-muted"> ×{times}</span>}
        </span>
        <span className="truncate text-[13px] leading-5 text-muted">{meta}</span>
      </span>
      <span className="shrink-0 text-[15px] leading-5 font-medium tabular-nums">{fmt(protein)} g</span>
    </>
  );
  return (
    <li className="group flex items-center gap-1 pr-2 pl-5">
      {tick ? (
        <form action={tick} className="min-w-0 flex-1">
          <Submit
            aria-pressed={done}
            aria-label={`${done ? "Eaten" : "Mark eaten"}: ${name}`}
            className="flex min-h-14 w-full items-center gap-3 py-2 text-left transition-opacity active:opacity-60"
          >
            {body}
          </Submit>
        </form>
      ) : (
        <div className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2">{body}</div>
      )}
      {remove ? (
        <form action={remove}>
          <Submit
            aria-label={removeLabel}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-control transition-[opacity,background-color,color] hover:bg-background hover:text-secondary lg:size-8 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
          >
            <Icon.x />
          </Submit>
        </form>
      ) : (
        <span className="size-11 shrink-0 lg:size-8" aria-hidden="true" />
      )}
    </li>
  );
}

type ProgressGoal = { key: string; label: string; done: boolean };

/**
 * One ring split into a segment per goal, filled (accent) as each is done.
 * Decorative: the card states the count and the goals in text.
 */
function SegmentRing({ goals, className = "", size = 200, stroke = 16 }: { goals: ProgressGoal[]; className?: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const n = goals.length;
  const gap = n > 1 ? 6 : 0; // px of arc between segments
  const seg = n ? (c - gap * n) / n : c;
  const mid = size / 2;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className={`shrink-0 ${className}`}>
      {n === 0 ? (
        <circle cx={mid} cy={mid} r={r} fill="none" className="stroke-line" strokeWidth={stroke} />
      ) : (
        goals.map((g, i) => (
          <circle
            key={g.key}
            cx={mid}
            cy={mid}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeDasharray={`${seg.toFixed(2)} ${(c - seg).toFixed(2)}`}
            strokeDashoffset={(-(i * (seg + gap)) + gap / 2).toFixed(2)}
            transform={`rotate(-90 ${mid} ${mid})`}
            className={`transition-colors ${g.done ? "stroke-accent" : "stroke-line"}`}
          />
        ))
      )}
    </svg>
  );
}

/**
 * Top of Today: how much of the day's non-nutrition goals is done.
 * Vertical so it fills the height of the article card beside it on laptop:
 * a header line, the ring centred in the free space, then the goals as a legend.
 */
function ProgressCard({ goals, className = "" }: { goals: ProgressGoal[]; className?: string }) {
  const done = goals.filter((g) => g.done).length;
  const left = goals.length - done;
  return (
    <section aria-label="Today's progress" className={`card flex flex-col gap-5 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] leading-5 font-medium text-muted">Today’s progress</p>
        <p className="text-[15px] leading-5 font-medium">
          {goals.length === 0 ? "Nothing set" : left === 0 ? "All done" : `${left} to go`}
        </p>
      </div>
      <div className="flex flex-1 items-center justify-center py-2">
        <div className="relative size-44 lg:size-52">
          <SegmentRing goals={goals} className="size-full" />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-4xl leading-10 font-medium tabular-nums">
              {done}
              <span className="text-muted">/{goals.length}</span>
            </span>
            <span className="text-[13px] leading-5 text-muted">done</span>
          </div>
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
        {goals.map((g) => (
          <li key={g.key} className="flex min-w-0 items-center gap-2 text-[15px] leading-5">
            <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${g.done ? "bg-accent" : "bg-line"}`} />
            <span className={`truncate ${g.done ? "text-foreground" : "text-muted"}`}>
              {g.label}
              <span className="sr-only">{g.done ? ", done" : ", not done"}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CounterTile({
  label,
  value,
  goal,
  streakDays,
  dec,
  inc,
}: {
  label: string;
  value: number;
  goal: number;
  streakDays: number;
  dec: () => Promise<void>;
  inc: () => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-card p-5">
      <TileHead label={label} done={value >= goal} />
      <p className="text-[28px] leading-8 font-medium tabular-nums lg:text-2xl">
        {value} <span className="text-[15px] font-normal text-muted lg:text-sm">of {goal}</span>
      </p>
      <StreakText days={streakDays} />
      <div className="mt-auto grid grid-cols-2 gap-2">
        <form action={dec}>
          <Submit aria-label={`One fewer: ${label}`} className="btn w-full text-secondary">
            <Icon.minus />
          </Submit>
        </form>
        <form action={inc}>
          <Submit aria-label={`One more: ${label}`} className="btn w-full">
            <Icon.plus />
          </Submit>
        </form>
      </div>
    </div>
  );
}

function CustomFoodForm({ date, meal }: { date: string; meal: MealName }) {
  return (
    <form action={addFood} className="mt-3 grid grid-cols-2 gap-2">
      <input type="hidden" name="date" value={date} />
      <label className="col-span-2">
        <span className="label">Name</span>
        <input name="name" required className="field" placeholder="Banana" />
      </label>
      <label>
        <span className="label">Meal</span>
        <select name="meal" defaultValue={meal} className="field capitalize">
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
      <label className="col-span-2 flex items-center gap-2 text-[15px]">
        <input type="checkbox" name="kExact" /> Potassium is exact (from a label)
      </label>
      <label className="col-span-2 flex items-center gap-2 text-[15px]">
        <input type="checkbox" name="saveFavourite" /> Save as favourite
      </label>
      <Submit className="btn-primary col-span-2">Add</Submit>
    </form>
  );
}
