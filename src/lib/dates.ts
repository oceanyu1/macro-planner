/** All "what day is it" logic uses Toronto time, not the server's UTC clock. */
export const TZ = "America/Toronto";

/** YYYY-MM-DD for the given instant in Toronto. */
export function isoDate(d: Date = new Date(), tz = TZ): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function today(): string {
  return isoDate();
}

/** Calendar arithmetic on YYYY-MM-DD strings (timezone-free, done in UTC). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** 0 = Monday ... 6 = Sunday */
export function weekdayMon0(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** Monday..Sunday of the week containing `iso`. */
export function weekOf(iso: string): string[] {
  const monday = addDays(iso, -weekdayMon0(iso));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function prettyDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
