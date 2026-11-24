# Macro Planner

Private PWA: what to eat at Teraanga Commons to hit protein under a sodium cap, plus the daily habit tracker.
Next.js 16 (App Router) · Auth.js (Google, one-email allowlist) · Supabase Postgres via Drizzle · Vercel Cron.

Targets (editable in Settings): **140 g protein · 1750 kcal · <2300 mg sodium · ~3400 mg potassium**.

## Scripts

| | |
|---|---|
| `npm run dev` | local dev server on :3000 |
| `npm test` | unit tests (parser, potassium math, habits, dates) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | write a new SQL migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | apply migrations in `drizzle/` to the database in `DIRECT_URL` |
| `npm run db:studio` | browse the database |

## Layout

```
src/
  auth.ts, proxy.ts        sign-in + sign-in wall (cron route exempt; it checks CRON_SECRET)
  db/schema.ts             all tables (settings.mode is the home/dining switch)
  lib/nutrition.ts         nutrition-panel parser, potassium estimate, totals, K:Na
  lib/habits.ts            tretinoin ramp, gym rotation, streaks
  lib/data.ts              read queries        app/actions.ts   all writes (server actions)
  app/(app)/               Today, Week, Goals, Settings
  app/api/cron/ingest      daily job (phase 2 fills it in)
fixtures/                  saved menu responses the parser tests run against
```

## Phases

1. **Foundation** — scaffold, auth, PWA, habits, home-mode meal template, quick-add ✅ code done
2. **Menu ingest** — find the JSON endpoint, parser + fixtures, daily cron, 7 days
3. **Plan + log** — greedy planner, tick-off from plan, potassium matching (CNF)
4. **Live + v2** — LLM planner, reminders, weekly report
