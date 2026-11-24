import { addDays, daysBetween, weekOf } from "./dates";

export type HabitRow = {
  date: string;
  waterMl: number;
  neckSets: number;
  gym: "upper" | "lower" | null;
  tretinoin: boolean;
  leetcode: number;
};

export type HabitGoals = {
  waterGoalMl: number;
  neckSetsGoal: number;
  leetcodeGoal: number;
  gymPerWeek: number;
  tretinoinStart: string | null;
};

export const emptyHabit = (date: string): HabitRow => ({
  date,
  waterMl: 0,
  neckSets: 0,
  gym: null,
  tretinoin: false,
  leetcode: 0,
});

/**
 * Tretinoin ramp: weeks 1–2 every third night, weeks 3–4 every other night,
 * week 5 on nightly. Returns false before the start date or with no start.
 */
export function isTretinoinNight(date: string, start: string | null): boolean {
  if (!start) return false;
  const d = daysBetween(start, date);
  if (d < 0) return false;
  if (d < 14) return d % 3 === 0;
  if (d < 28) return d % 2 === 0;
  return true;
}

export function tretinoinPhase(date: string, start: string | null): string | null {
  if (!start) return null;
  const d = daysBetween(start, date);
  if (d < 0) return "not started";
  if (d < 14) return "every 3rd night";
  if (d < 28) return "every other night";
  return "nightly";
}

/** Upper/lower rotation: suggest the opposite of the most recent gym day. */
export function nextGym(history: HabitRow[]): "upper" | "lower" {
  const last = [...history]
    .filter((h) => h.gym)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return last?.gym === "upper" ? "lower" : "upper";
}

export function gymCountThisWeek(rows: HabitRow[], date: string): number {
  const week = new Set(weekOf(date));
  return rows.filter((r) => r.gym && week.has(r.date)).length;
}

export type HabitKey = "water" | "neck" | "leetcode" | "tretinoin";

export function hit(key: HabitKey, row: HabitRow, goals: HabitGoals): boolean {
  switch (key) {
    case "water":
      return row.waterMl >= goals.waterGoalMl;
    case "neck":
      return row.neckSets >= goals.neckSetsGoal;
    case "leetcode":
      return row.leetcode >= goals.leetcodeGoal;
    case "tretinoin":
      // An off night counts as kept; an on night needs the box ticked.
      return !isTretinoinNight(row.date, goals.tretinoinStart) || row.tretinoin;
  }
}

/**
 * Consecutive days the habit was hit, ending today. If today isn't done yet the
 * streak still counts through yesterday, so it doesn't read 0 every morning.
 */
export function streak(
  key: HabitKey,
  byDate: Map<string, HabitRow>,
  goals: HabitGoals,
  todayIso: string,
): number {
  let n = 0;
  let d = todayIso;
  if (!hit(key, byDate.get(d) ?? emptyHabit(d), goals)) d = addDays(d, -1);
  for (let i = 0; i < 366; i++) {
    const row = byDate.get(d) ?? emptyHabit(d);
    if (!hit(key, row, goals)) break;
    n++;
    d = addDays(d, -1);
  }
  return n;
}
