import Link from "next/link";
import { signOut } from "@/auth";
import { addTemplateItem, deleteFavourite, deleteTemplateItem, saveSettings } from "@/app/actions";
import { PullMenuButton } from "@/components/pull-menu";
import { Submit } from "@/components/ui";
import type { MealName } from "@/db/schema";
import { getFavourites, getMenuCoverage, getSettings, getTemplate } from "@/lib/data";
import { addDays, prettyDate, today } from "@/lib/dates";
import { sumNutrients } from "@/lib/nutrition";
import { requireUser } from "@/lib/session";

const MEALS: MealName[] = ["breakfast", "lunch", "dinner", "snack"];

// "Pull menu now" runs the 7-day ingest inside this page's server action.
export const maxDuration = 300;

export default async function SettingsPage() {
  const user = await requireUser();
  const start = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const [s, template, favourites, menu] = await Promise.all([
    getSettings(),
    getTemplate(),
    getFavourites(),
    getMenuCoverage(days[0], days[6]),
  ]);
  const menuCount = (d: string, m: MealName) => menu.rows.find((r) => r.date === d && r.meal === m)?.items ?? 0;
  const tTotals = sumNutrients(template);
  const splitSum = MEALS.reduce((a, m) => a + (s.proteinSplit[m] ?? 0), 0);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Settings</h1>

      <form action={saveSettings} className="space-y-4">
        {/* the switch */}
        <section className="card">
          <h2 className="h2 mb-2">Mode</h2>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["home", "Home", "Fixed meal-prep template"],
                ["dining", "Dining hall", "Daily menu pull + plan"],
              ] as const
            ).map(([v, l, d]) => (
              <label
                key={v}
                className="cursor-pointer rounded-xl border border-line p-3 has-[:checked]:border-accent has-[:checked]:bg-accent/10"
              >
                <input type="radio" name="mode" value={v} defaultChecked={s.mode === v} className="sr-only" />
                <div className="font-medium">{l}</div>
                <div className="text-xs text-muted">{d}</div>
              </label>
            ))}
          </div>
        </section>

        <section className="card grid grid-cols-2 gap-3">
          <h2 className="h2 col-span-2">Daily targets</h2>
          <Num name="proteinTargetG" label="Protein (g)" value={s.proteinTargetG} />
          <Num name="calorieTarget" label="Calories" value={s.calorieTarget} />
          <Num name="sodiumCapMg" label="Sodium cap (mg)" value={s.sodiumCapMg} />
          <Num name="potassiumGoalMg" label="Potassium goal (mg)" value={s.potassiumGoalMg} />
          <Num name="calorieTolerance" label="Calorie ± range" value={s.calorieTolerance} />
        </section>

        <section className="card grid grid-cols-4 gap-2">
          <h2 className="h2 col-span-4">
            Protein split{" "}
            <span className={`normal-case ${splitSum === s.proteinTargetG ? "text-good" : "text-warn"}`}>
              ({splitSum} g of {s.proteinTargetG})
            </span>
          </h2>
          <Num name="splitBreakfast" label="Breakfast" value={s.proteinSplit.breakfast} />
          <Num name="splitLunch" label="Lunch" value={s.proteinSplit.lunch} />
          <Num name="splitDinner" label="Dinner" value={s.proteinSplit.dinner} />
          <Num name="splitSnack" label="Snack" value={s.proteinSplit.snack} />
        </section>

        <section className="card space-y-3">
          <h2 className="h2">Planner rules</h2>
          <label className="block">
            <span className="label">Never pick (comma-separated)</span>
            <input name="blockedFoods" defaultValue={s.blockedFoods.join(", ")} className="field" />
          </label>
          <label className="block">
            <span className="label">Preferred stations</span>
            <input
              name="preferredStations"
              defaultValue={s.preferredStations.join(", ")}
              placeholder="Training Table, Grill"
              className="field"
            />
          </label>
        </section>

        <section className="card grid grid-cols-2 gap-3">
          <h2 className="h2 col-span-2">Habit goals</h2>
          <Num name="waterGoalMl" label="Water (mL)" value={s.waterGoalMl} />
          <Num name="neckSetsGoal" label="Neck sets" value={s.neckSetsGoal} />
          <Num name="gymPerWeek" label="Gym days / week" value={s.gymPerWeek} />
          <Num name="leetcodeGoal" label="LeetCode / day" value={s.leetcodeGoal} />
          <label className="col-span-2">
            <span className="label">Tretinoin start (ramp: every 3rd night → every other → nightly)</span>
            <input name="tretinoinStart" type="date" defaultValue={s.tretinoinStart ?? ""} className="field" />
          </label>
        </section>

        <Submit className="btn-primary w-full">Save settings</Submit>
      </form>

      {/* dining-hall menu ingest */}
      <section className="card space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="h2">Dining hall menu</h2>
          <span className="text-xs text-muted">
            {menu.lastUpdated
              ? `updated ${menu.lastUpdated.toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" })}`
              : "never pulled"}
          </span>
        </div>
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-xs text-muted">
              <th className="text-left font-normal">Items per meal</th>
              <th className="font-normal">B</th>
              <th className="font-normal">L</th>
              <th className="font-normal">D</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d}>
                <td>{prettyDate(d)}</td>
                {(["breakfast", "lunch", "dinner"] as const).map((m) => {
                  const n = menuCount(d, m);
                  return (
                    <td key={m} className={`text-center ${n ? "" : "text-muted"}`}>
                      {n || "–"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted">
          Pulled nightly in dining mode. The button works in either mode.
        </p>
        <PullMenuButton />
        <Link href="/settings/potassium" className="flex items-center justify-between text-xs text-muted">
          <span>Potassium sources (optional)</span>
          <span>›</span>
        </Link>
      </section>

      {/* home template */}
      <section className="card space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="h2">Home meal template</h2>
          <span className="text-xs tabular-nums text-muted">
            {Math.round(tTotals.proteinG)} g · {tTotals.calories} kcal · {tTotals.sodiumMg} mg Na
          </span>
        </div>
        {MEALS.map((m) => {
          const items = template.filter((t) => t.meal === m);
          if (!items.length) return null;
          return (
            <div key={m}>
              <div className="label capitalize">{m}</div>
              <ul className="divide-y divide-line text-sm">
                {items.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 py-1.5">
                    <span className="flex-1">
                      {t.name}
                      {t.servings !== 1 && <span className="text-muted"> ×{t.servings}</span>}
                    </span>
                    <span className="text-xs tabular-nums text-muted">
                      {t.proteinG}g · {t.calories} kcal · {t.sodiumMg}mg Na · ~{t.potassiumMg}K
                    </span>
                    <form action={deleteTemplateItem.bind(null, t.id)}>
                      <Submit className="px-1 text-muted" aria-label={`Remove ${t.name}`}>
                        ✕
                      </Submit>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        <details open={!template.length}>
          <summary className="cursor-pointer text-sm text-accent">Add template item…</summary>
          <form action={addTemplateItem} className="mt-3 grid grid-cols-2 gap-2">
            <label className="col-span-2">
              <span className="label">Name</span>
              <input name="name" required className="field" placeholder="Chicken + rice bowl" />
            </label>
            <label>
              <span className="label">Meal</span>
              <select name="meal" className="field">
                {MEALS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <Num name="servings" label="Servings" value={1} step="0.25" />
            <Num name="proteinG" label="Protein (g, total)" />
            <Num name="calories" label="Calories (total)" />
            <Num name="sodiumMg" label="Sodium (mg, total)" />
            <Num name="potassiumMg" label="Potassium (mg, total)" />
            <Submit className="btn-primary col-span-2">Add to template</Submit>
          </form>
        </details>
      </section>

      {favourites.length > 0 && (
        <section className="card">
          <h2 className="h2 mb-2">Favourites</h2>
          <ul className="divide-y divide-line text-sm">
            {favourites.map((f) => (
              <li key={f.id} className="flex items-center gap-2 py-1.5">
                <span className="flex-1">{f.name}</span>
                <span className="text-xs tabular-nums text-muted">
                  {f.proteinG}g · {f.calories} kcal · {f.sodiumMg}mg Na
                </span>
                <form action={deleteFavourite.bind(null, f.id)}>
                  <Submit className="px-1 text-muted" aria-label={`Remove ${f.name}`}>
                    ✕
                  </Submit>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
        className="text-center"
      >
        <p className="mb-2 text-xs text-muted">Signed in as {user.email}</p>
        <button className="btn">Sign out</button>
      </form>
    </div>
  );
}

function Num({ name, label, value, step = "any" }: { name: string; label: string; value?: number; step?: string }) {
  return (
    <label>
      <span className="label">{label}</span>
      <input name={name} type="number" min="0" step={step} inputMode="decimal" defaultValue={value} className="field" />
    </label>
  );
}
