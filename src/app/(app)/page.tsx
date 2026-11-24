import Link from "next/link";
import {
  addFood,
  adjustHabit,
  deleteFood,
  logFavourite,
  setGym,
  setTretinoin,
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
  getSettings,
  getTemplate,
  getTemplateLogged,
} from "@/lib/data";
import { gymCountThisWeek, isTretinoinNight, nextGym, streak, tretinoinPhase } from "@/lib/habits";
import { kNaRatio, sumNutrients } from "@/lib/nutrition";
import { requireUser } from "@/lib/session";

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

      {/* meals */}
      {MEALS.map((m) => {
        const items = log.filter((l) => l.meal === m);
        const tmpl = settings.mode === "home" ? template.filter((t) => t.meal === m) : [];
        const mealTotals = sumNutrients(items);
        const split = settings.proteinSplit[m] ?? 0;
        if (!items.length && !tmpl.length && m === "snack") return null;
        return (
          <section key={m} className="card">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="h2">{m}</h2>
              <span className="text-xs tabular-nums text-muted">
                {Math.round(mealTotals.proteinG)} / {split} g protein
              </span>
            </div>

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

            {items.filter((i) => i.source !== "template").length > 0 && (
              <ul className="divide-y divide-line text-sm">
                {items
                  .filter((i) => i.source !== "template")
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

            {!items.length && !tmpl.length && (
              <p className="text-sm text-muted">
                {settings.mode === "home" ? "Nothing logged. Add a home template in Settings." : "Plan arrives in phase 3."}
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
