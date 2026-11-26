import Link from "next/link";
import { addDays, isValidIsoDate, prettyDate, today, weekOf } from "@/lib/dates";
import { getFoodLogRange, getHabitRange, getSettings } from "@/lib/data";
import { emptyHabit, hit, isTretinoinNight, streak, type HabitKey } from "@/lib/habits";
import { kNaRatio, sumNutrients } from "@/lib/nutrition";
import { requireUser } from "@/lib/session";

export default async function WeekPage({ searchParams }: PageProps<"/week">) {
  await requireUser();
  const sp = await searchParams;
  const now = today();
  const anchor = typeof sp.date === "string" && isValidIsoDate(sp.date) ? sp.date : now;
  const days = weekOf(anchor);

  const [settings, habits, food, history] = await Promise.all([
    getSettings(),
    getHabitRange(days[0], days[6]),
    getFoodLogRange(days[0], days[6]),
    getHabitRange(addDays(now, -366), now),
  ]);
  const byDate = new Map(habits.map((h) => [h.date, h]));
  const historyMap = new Map(history.map((h) => [h.date, h]));

  const rows = days.map((d) => {
    const h = byDate.get(d) ?? emptyHabit(d);
    const t = sumNutrients(food.filter((f) => f.date === d));
    return { d, h, t, future: d > now };
  });
  const gymCount = rows.filter((r) => r.h.gym).length;
  const logged = rows.filter((r) => r.t.calories > 0 || r.t.proteinG > 0);
  const proteinDays = logged.filter((r) => r.t.proteinG >= settings.proteinTargetG).length;
  const sodiumDays = logged.filter((r) => r.t.sodiumMg <= settings.sodiumCapMg).length;
  const weekTotals = sumNutrients(logged.map((r) => r.t));
  const avgKna = kNaRatio(weekTotals.potassiumMg, weekTotals.sodiumMg);

  const habitCols: { key: HabitKey; label: string }[] = [
    { key: "water", label: "💧" },
    { key: "neck", label: "Neck" },
    { key: "leetcode", label: "LC" },
    ...(settings.tretinoinStart ? [{ key: "tretinoin" as const, label: "Tret" }] : []),
  ];

  return (
    <div className="space-y-4 lg:max-w-2xl">
      <header className="flex items-center justify-between">
        <Link href={`/week?date=${addDays(days[0], -7)}`} className="btn w-10" aria-label="Previous week">
          ‹
        </Link>
        <h1 className="text-lg font-semibold">Week of {prettyDate(days[0])}</h1>
        <Link href={`/week?date=${addDays(days[0], 7)}`} className="btn w-10" aria-label="Next week">
          ›
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-2">
        <Stat label="Protein days" value={`${proteinDays} / ${logged.length}`} />
        <Stat label="Under sodium cap" value={`${sodiumDays} / ${logged.length}`} />
        <Stat label="Gym" value={`${gymCount} / ${settings.gymPerWeek}`} good={gymCount >= settings.gymPerWeek} />
        <Stat label="Avg K:Na" value={avgKna == null ? "–" : `~${avgKna}`} est />
      </section>

      <section className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th className="p-2 text-left font-medium">Day</th>
              {habitCols.map((c) => (
                <th key={c.key} className="p-2 font-medium">
                  {c.label}
                </th>
              ))}
              <th className="p-2 font-medium">Gym</th>
              <th className="p-2 text-right font-medium">Protein</th>
              <th className="p-2 text-right font-medium">Na</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ d, h, t, future }) => (
              <tr key={d} className={`border-b border-line last:border-0 ${d === now ? "bg-accent/5" : ""}`}>
                <td className="p-2">
                  <Link href={`/?date=${d}`} className="text-accent">
                    {prettyDate(d).split(",")[0]}
                  </Link>
                </td>
                {habitCols.map((c) => (
                  <td key={c.key} className="p-2 text-center">
                    {future ? "" : c.key === "tretinoin" && !isTretinoinNight(d, settings.tretinoinStart) ? (
                      <span className="text-muted">·</span>
                    ) : hit(c.key, h, settings) ? (
                      <span className="text-good">✓</span>
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </td>
                ))}
                <td className="p-2 text-center text-xs capitalize">{h.gym ?? ""}</td>
                <td
                  className={`p-2 text-right tabular-nums ${t.proteinG >= settings.proteinTargetG ? "text-good" : ""}`}
                >
                  {t.proteinG ? Math.round(t.proteinG) : ""}
                </td>
                <td className={`p-2 text-right tabular-nums ${t.sodiumMg > settings.sodiumCapMg ? "text-bad" : ""}`}>
                  {t.sodiumMg || ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 className="h2 mb-2">Current streaks</h2>
        <ul className="grid grid-cols-2 gap-2 text-sm">
          {habitCols.map((c) => (
            <li key={c.key} className="flex justify-between">
              <span>{c.key === "water" ? "Water" : c.key === "neck" ? "Neck" : c.key === "leetcode" ? "LeetCode" : "Tretinoin"}</span>
              <span className="tabular-nums font-semibold">{streak(c.key, historyMap, settings, now)}d</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, good, est }: { label: string; value: string; good?: boolean; est?: boolean }) {
  return (
    <div className="card p-3">
      <div className="label">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${good ? "text-good" : est ? "text-est" : ""}`}>{value}</div>
    </div>
  );
}
