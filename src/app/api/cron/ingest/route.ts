import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/data";
import { today } from "@/lib/dates";
import { ingestRange } from "@/lib/menu/ingest";

// ~21 sequential requests of 0.5–1.3 MB each; ingestRange stops starting new days at 240 s.
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  return !!secret && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/** Vercel Cron calls this daily (~3 am Toronto): pull today + 6 days. Phase 3 adds the planner. */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const settings = await getSettings();
  if (settings.mode === "home") {
    return NextResponse.json({ ok: true, skipped: "home mode" });
  }

  const report = await ingestRange(today(), 7);
  // TODO(phase 3): plan tomorrow.
  // A non-2xx status makes failures show up in Vercel's cron and function logs.
  return NextResponse.json(report, { status: report.ok ? 200 : 502 });
}
