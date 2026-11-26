import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/data";
import { addDays, today } from "@/lib/dates";
import { ingestRange } from "@/lib/menu/ingest";
import { generatePlan } from "@/lib/plan-service";
import { estimateMenuPotassium } from "@/lib/potassium-service";

// ~21 sequential requests of 0.5–1.3 MB each; ingestRange stops starting new days at 240 s.
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  return !!secret && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/** Vercel Cron calls this daily (~3 am Toronto): pull today + 6 days, then plan today and tomorrow. */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const settings = await getSettings();
  if (settings.mode === "home") {
    return NextResponse.json({ ok: true, skipped: "home mode" });
  }

  const start = today();
  const report = await ingestRange(start, 7);
  // Potassium estimates for new dishes (CNF best guess, reviewable in Settings).
  let potassium: Awaited<ReturnType<typeof estimateMenuPotassium>> | { error: string };
  try {
    potassium = await estimateMenuPotassium();
  } catch (err) {
    potassium = { error: (err as Error).message };
    console.error("potassium:", (err as Error).message);
  }
  // Re-plan today and tomorrow against the fresh menu. Locked (eaten) meals and rejections are kept.
  const planned: Record<string, boolean> = {};
  for (const d of [start, addDays(start, 1)]) {
    try {
      planned[d] = (await generatePlan(d)) != null;
    } catch (err) {
      planned[d] = false;
      console.error(`plan ${d}:`, (err as Error).message);
    }
  }
  // A non-2xx status makes failures show up in Vercel's cron and function logs.
  return NextResponse.json({ ...report, potassium, planned }, { status: report.ok ? 200 : 502 });
}
