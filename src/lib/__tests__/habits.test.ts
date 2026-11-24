import { describe, expect, it } from "vitest";
import { addDays, isoDate, weekOf } from "../dates";
import { emptyHabit, gymCountThisWeek, isTretinoinNight, nextGym, streak, type HabitGoals, type HabitRow } from "../habits";

const goals: HabitGoals = { waterGoalMl: 3000, neckSetsGoal: 3, leetcodeGoal: 1, gymPerWeek: 4, tretinoinStart: "2026-11-01" };

describe("dates", () => {
  it("uses Toronto time, not UTC", () => {
    // 03:00 UTC on Nov 24 is still Nov 23 in Toronto
    expect(isoDate(new Date("2026-11-24T03:00:00Z"))).toBe("2026-11-23");
  });
  it("weeks start Monday", () => {
    expect(weekOf("2026-11-23")[0]).toBe("2026-11-23"); // a Monday
    expect(weekOf("2026-11-29")[0]).toBe("2026-11-23");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("tretinoin ramp", () => {
  it("every 3rd night, then every other, then nightly", () => {
    expect(isTretinoinNight("2026-11-01", goals.tretinoinStart)).toBe(true);
    expect(isTretinoinNight("2026-11-02", goals.tretinoinStart)).toBe(false);
    expect(isTretinoinNight("2026-11-04", goals.tretinoinStart)).toBe(true);
    expect(isTretinoinNight("2026-11-15", goals.tretinoinStart)).toBe(true); // day 14
    expect(isTretinoinNight("2026-11-16", goals.tretinoinStart)).toBe(false);
    expect(isTretinoinNight("2026-11-30", goals.tretinoinStart)).toBe(true); // day 29
    expect(isTretinoinNight("2026-10-31", goals.tretinoinStart)).toBe(false);
    expect(isTretinoinNight("2026-11-01", null)).toBe(false);
  });
});

describe("gym", () => {
  it("alternates upper/lower and counts the week", () => {
    const rows: HabitRow[] = [
      { ...emptyHabit("2026-11-23"), gym: "upper" },
      { ...emptyHabit("2026-11-24"), gym: "lower" },
      { ...emptyHabit("2026-11-20"), gym: "upper" },
    ];
    expect(nextGym(rows)).toBe("upper");
    expect(nextGym([])).toBe("upper");
    expect(gymCountThisWeek(rows, "2026-11-25")).toBe(2);
  });
});

describe("streak", () => {
  const rows = new Map<string, HabitRow>();
  for (const d of ["2026-11-20", "2026-11-21", "2026-11-22"]) rows.set(d, { ...emptyHabit(d), waterMl: 3000 });

  it("counts through yesterday when today isn't done yet", () => {
    expect(streak("water", rows, goals, "2026-11-23")).toBe(3);
  });
  it("includes today once it's done", () => {
    const r = new Map(rows).set("2026-11-23", { ...emptyHabit("2026-11-23"), waterMl: 3200 });
    expect(streak("water", r, goals, "2026-11-23")).toBe(4);
  });
  it("breaks on a missed day", () => {
    expect(streak("water", rows, goals, "2026-11-25")).toBe(0);
  });
});
