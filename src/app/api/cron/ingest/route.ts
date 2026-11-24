import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/data";

export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  return !!secret && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/** Vercel Cron calls this daily (~3 am Toronto). Phase 2 adds the menu pull, phase 3 the planner. */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const settings = await getSettings();
  if (settings.mode === "home") {
    return NextResponse.json({ ok: true, skipped: "home mode" });
  }

  // TODO(phase 2): ingest today + 6 days. TODO(phase 3): plan tomorrow.
  return NextResponse.json({ ok: true, ingested: 0 });
}
