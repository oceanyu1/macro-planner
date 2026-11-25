<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Macro Planner — project notes for agents

Private, single-user PWA. It plans what to eat at the Teraanga Commons dining hall (menu on MyDiningHub) to hit a protein target under a sodium cap, logs what was eaten, and replaces the user's old habit tracker. The source of truth for scope is the design plan "Dining Hall Macro Planner — Design Plan" (Nov 23 2026). The user is not keeping a copy in the repo, so this file summarises it.

## How to work with the user

- Build in phases (below). **Stop and hand over whenever user action is needed**: dashboards, credentials, OAuth consoles, DevTools capture of the menu API. Give exact click paths.
- Never print or ask the user to paste secrets. Scripts that need `.env.local` should report `set` or `MISSING` and connection status only.
- Commit only when asked. Push only when asked (the remote is GitHub and Vercel auto-deploys `main`).
- Verify before claiming done: `npm run typecheck && npm test && npx eslint && npx next build`.

## Status (updated 2026-11-24)

| Phase | State |
|---|---|
| 1. Foundation: auth, schema, habits, home-mode meals, PWA | **Done and deployed** |
| 2. Menu ingest | **Done.** Verified live 2026-11-24 via Settings → Pull menu now (7 days, ~40 B / ~75 L / ~80 D items). Cron path not yet exercised (mode is still `home`) |
| 3. Planner v1 (greedy), tick-off from plan, potassium matching | **In progress** |
| 4. LLM planner (v2), push reminders, weekly report | Not started |

- **Production:** https://macro-planner-three-pi.vercel.app (Vercel Hobby, region `pdx1`). **Repo:** github.com/oceanyu1/macro-planner, `main`.
- **Supabase:** Postgres 17, West US (Oregon). Migrations `0000_init` and `0001_lock_rest_api` are applied.
- iOS white-screen hang (postgres.js pipelining) is fixed by `d45c349`; user confirmed on the phone 2026-11-24.

## Decisions already made (don't re-ask)

- **Targets:** protein 140 g, calories 1750 (±100), sodium under 2300 mg, potassium ~3400 mg. Protein split 30/45/45 + 20 g snack. Blocked foods: pork, tofu.
- **Menu data:** the menu item *details* panel gives serving size, calories, fat, sat/trans fat, cholesterol, sodium, carbs, fiber, sugars, protein and an ingredients line. **No potassium.** Sample: `fixtures/panel-bbq-baked-chicken.txt`.
- **Terms of Use:** they allow automated personal access.
- **Old tracker:** there is none to migrate. Ignore the plan's "keep current tracker page" question.
- **Modes:** home mode (Toronto, now) uses a hand-edited meal template. Dining mode starts at January 2027 move-in. `settings.mode` is the switch, and the cron skips while it is `home`.
- **Habit defaults (assumed, user may change):** water 3 L, 3 neck sets, 1 LeetCode a day, gym 4 a week on an upper/lower rotation. Tretinoin ramp is every 3rd night for weeks 1–2, every other night for weeks 3–4, then nightly (`src/lib/habits.ts`).

## Stack

- Next.js **16.4** App Router + TypeScript + Tailwind **v4**.
- Auth.js v5 beta (`next-auth@5.0.0-beta.32`): Google provider, JWT sessions, allowlist from `ALLOWED_EMAILS`.
- Supabase Postgres via Drizzle ORM on **node-postgres (`pg`)**.
- Vitest 3 for unit tests. Vercel Cron for the daily job (`vercel.json`, `0 8 * * *` UTC ≈ 3 am Toronto).

## Layout

```
src/auth.ts                  Auth.js config + allowlist
src/proxy.ts                 sign-in wall (Next 16 "proxy" = old middleware). Exempts /login, /api/auth, /api/cron, icons, manifest, sw.js
src/lib/session.ts           requireUser(): call at the top of EVERY page and server action
src/db/schema.ts             all tables; src/db/index.ts = lazy pg Pool + attachDatabasePool
src/lib/data.ts              read queries        src/app/actions.ts   all writes (server actions, zod-validated)
src/lib/nutrition.ts         nutrition-panel parser, serving→grams, potassium estimate, totals, K:Na
src/lib/habits.ts            tretinoin ramp, gym rotation, streaks      src/lib/dates.ts  Toronto-time date helpers
src/app/(app)/               Today (/), /week, /goals, /settings   src/app/login/
src/lib/menu/api.ts          endpoint, headers, query, meal period ids, station names
src/lib/menu/parse.ts        pure response parser (tested on fixtures)   kind.ts  protein/veg/starch/dessert classifier
src/lib/menu/ingest.ts       fetch + upsert menu_item + rewrite menu_day per date×meal; ingestRange(start, days)
src/app/api/cron/ingest/     daily job: checks Bearer CRON_SECRET, exits in home mode, else ingests today+6; plan is TODO
src/app/manifest.ts, icons/[size]/route.tsx, apple-icon.tsx, public/sw.js   PWA
drizzle/                     generated SQL migrations     fixtures/   saved menu responses for parser tests
```

Tables: `settings` (one row, id=1, created with defaults on first read), `menu_item`, `menu_day`, `k_mapping`, `plan`, `food_log` (nutrients snapshotted at log time), `favourite_food`, `meal_template`, `habit_day`, `application`, `milestone`.

## Commands

`npm run dev` · `npm test` · `npm run typecheck` · `npm run db:generate` (after schema edits) · `npm run db:migrate` (uses `DIRECT_URL`) · `npm run db:studio`

Env (`.env.local` locally and in Vercel; see `.env.example`): `DATABASE_URL` (transaction pooler :6543), `DIRECT_URL` (session pooler :5432, migrations only), `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAILS`, `CRON_SECRET`. Later: `ANTHROPIC_API_KEY` (server-only, cron).

## Gotchas learned the hard way

- **`cacheComponents` is deliberately OFF** in `next.config.ts`. `partialPrefetching` requires it, so that is off too. Every screen reads the session and DB, so there is no static shell to gain, and turning it on forces Suspense around every read.
- **Use `pg`, not postgres.js.** postgres.js pipelines concurrent queries on one socket. When Vercel suspends a function mid-pipeline, Supabase's transaction pooler leaves the backend `active / ClientRead` until the 2-minute statement timeout, and the late rejection crashes the function (exit 128). Keep `attachDatabasePool`, `query_timeout`, and the `pool.on("error")` handler.
- **TLS:** pg uses `ssl: { rejectUnauthorized: false }` because the Supabase pooler cert isn't in Node's CA store. Verified TLS 1.3.
- **RLS is enabled with no policies on every table** (migration 0001) so Supabase's public REST API can't read them. The app connects as `postgres`, which bypasses RLS. **New tables need `ENABLE ROW LEVEL SECURITY` in a custom migration** (`drizzle-kit generate --custom`).
- **Don't use Supabase's plain "Direct connection" string** (`db.<ref>.supabase.co`): it's IPv6-only on the free tier. Use the pooler strings.
- **Tailwind v4:** custom classes that are `@apply`-ed elsewhere (`btn`, `card`, `field`, `label`, `h2`, `btn-primary`) must be `@utility`, not `@layer components`. Potassium estimates always render with `~` in the `text-est` (amber) colour.
- **`"use server"` files may only export async functions.**
- **npm 10 crashes (`edgesOut`) installing vitest 4.** Stay on vitest 3.
- **iOS home-screen apps have their own cookie jar.** The installed app must sign in separately from Safari.
- **Dates are Toronto time** (`src/lib/dates.ts`). Never use the server's UTC "today".

## Menu API (captured 2026-11-24)

- Public Adobe Commerce GraphQL, **GET** `https://api.elevate-dxp.com/api/mesh/c087f756-cc72-4649-a36f-3a41b700c519/graphql` with `query`, `operationName=getLocationRecipes`, `variables` in the query string. Full query in `fixtures/location-recipes.request.json`; headers in `fixtures/location-recipes.curl.txt` (`store`/`magento-store-view-code: can_carleton_en`, `magento-store-code`/`magento-website-code: can_carleton`, `magento-customer-group` = guest, `x-api-key: ElevateAPIProd`, `aem-elevate-clientpath: can/carleton/en`). No login or secret.
- Variables: `campusUrlKey: "campus"`, `locationUrlKey: "teraanga-commons-dining-hall"`, `date: "YYYY-MM-DD"`, `mealPeriod`, `viewType: "DAILY"`. Meal period IDs: Breakfast 10, Brunch 13, Lunch 25, Dinner 16, All Day 4. One request = one date × one meal, and nutrition is inline, so **no per-item details request**.
- Response: `locationRecipesMap.dateSkuMap[].stations[]` maps station id → `simple` SKUs and `configurable` {sku, variants}. `products.items[]` have `name`, `sku`, `attributes[]` (name/value strings: `marketing_name`, `calories`, `protein`, `sodium`, `total_fat`, `saturated_fat`, `trans_fat`, `cholesterol`, `total_carbohydrates`, `dietary_fiber`, `sugars`, `serving_size`/`serving_unit`/`serving_combined`, `recipe_ingredients`, `allergen_statement`, `recipe_id`, `is_hide_from_web_menu`). No potassium.
- Configurable items (`Catalog_ComplexProductView`) have no top-level nutrition. Each variant's nutrition is in the JSON-string attribute `configurable_option_attributes`, keyed by option id. `options[].values[]` maps that same id to the serving title (e.g. `"85 millilitre"`).
- SKU format: `<location 277715>_<116163>_<recipe id>_4[_<variant>]`.
- Station names, meal periods and `maxMenusDate` (menus are published ~12 days ahead) come from a separate `getLocation` query; sample in `fixtures/stations.json`.
- Ingest rules: `menu_item.source_id` = `recipe_id` (stable; the SKU prefix may change per menu cycle). Skip `is_bulk` servings (1 kg / 8 L batch sizes) and anything over 9.5 kcal per g/mL (source typos). Lunch falls back to Brunch (13) when empty. A failed meal leaves its existing rows alone. `kind` is only set when null, so hand corrections survive.
- `fixtures/location-recipes-2026-11-24.json` is **Dinner** (mealPeriod 16); `...-lunch.json` is Lunch (25); `...-breakfast.json` is Breakfast (10). Lunch and dinner share 60 of 80 SKUs (salad bar, deli, pizza, bakery, etc.); the ~20 that differ are the hot entrées and sides. Breakfast shares only 4 of its 39 with dinner. Fetch every meal separately.

## Phase 2 plan (menu ingest)

1. User opens the Teraanga page with DevTools → Network → Fetch/XHR, changes the date and meal, opens an item's details, and saves 2–3 JSON responses into `fixtures/`, plus the URLs and query params.
2. Write the parser and tests against the fixtures. Never hit the live site while developing.
3. Write `ingest(date)`: for each meal, upsert `menu_item` by (source_id, serving_size), write `menu_day` rows, idempotent. (Nutrition comes inline, so there is no separate details fetch.)
4. Cron: ingest today + 6 days and stay a polite client (few requests, clear User-Agent). Email on failure later.
5. Fallback if there's no clean API: Playwright on a GitHub Actions schedule posting to the app.

## Planner rules (phase 3)

- Greedy v1 is the permanent fallback:
  1. Filter out blocked foods and desserts.
  2. Score by protein per 100 kcal, minus a sodium-per-gram-of-protein penalty.
  3. Fill each meal to its protein share, then add a vegetable and a starch if calories allow.
  4. If the day is over the sodium cap, swap the worst item.
- Eatable rules: at most 2 protein items per meal, at least 1 vegetable at lunch and dinner, at most 2 servings of any item, and a Regenerate button that excludes rejected items. Plan 5–10 g of protein above target as a buffer.
- Potassium = CNF mg per 100 g × serving grams ÷ 100 (1 mL ≈ 1 g), cached in `k_mapping`. A Review screen confirms matches.
- v2: the LLM picks with structured output; code recomputes totals and sends gaps back. After 2 failed revisions, fall back to greedy. Never show a plan that misses the targets.
