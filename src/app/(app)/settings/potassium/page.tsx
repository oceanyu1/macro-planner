import Link from "next/link";
import { changeKMatch, confirmAllKMatches, confirmKMatch } from "@/app/actions";
import { Submit } from "@/components/ui";
import { getPotassiumReview } from "@/lib/data";
import { potassiumKey, searchCnf, suggestCnf } from "@/lib/potassium";
import { requireUser } from "@/lib/session";

/**
 * Potassium Review: each dish (by name) is matched to one Canadian Nutrient File
 * food. Confirm the guess, pick another suggestion, search CNF, or mark "no good
 * match" (potassium stays unknown for that dish).
 */
export default async function PotassiumReviewPage({ searchParams }: PageProps<"/settings/potassium">) {
  await requireUser();
  const sp = await searchParams;
  const showAll = sp.show === "all";
  const searchKey = typeof sp.key === "string" ? sp.key : null;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";

  const { maps, items } = await getPotassiumReview();
  const dishes = new Map<string, typeof items>();
  for (const it of items) {
    const k = potassiumKey(it.name);
    dishes.set(k, [...(dishes.get(k) ?? []), it]);
  }
  const toReview = maps.filter((m) => !m.confirmed);
  const shown = showAll ? maps : toReview;

  return (
    <div className="space-y-4 lg:max-w-2xl">
      <header className="flex items-center justify-between">
        <Link href="/settings" className="btn w-10" aria-label="Back to settings">
          ‹
        </Link>
        <h1 className="text-lg font-semibold">Potassium matches</h1>
        <span className="w-10" />
      </header>

      <section className="card space-y-2 text-sm">
        <p>
          The menu has no potassium, so each dish is matched to a food in Health Canada&apos;s Canadian Nutrient File and
          estimated from its serving size. Estimates show as <span className="text-est">~mg</span>.
        </p>
        <p className="text-muted">
          Optional. The matches below are already in use, and nothing here needs your attention. Change one only if
          it&apos;s clearly the wrong food.
        </p>
        <p className="text-muted">
          {toReview.length} to review · {maps.length - toReview.length} confirmed ·{" "}
          <Link href={showAll ? "/settings/potassium" : "/settings/potassium?show=all"} className="text-accent">
            {showAll ? "show only to review" : "show all"}
          </Link>
        </p>
        {toReview.length > 0 && (
          <form action={confirmAllKMatches}>
            <Submit className="btn w-full">✓ All {toReview.length} look right</Submit>
          </form>
        )}
      </section>

      {shown.length === 0 && (
        <p className="text-center text-sm text-muted">
          {maps.length ? "Nothing left to review." : "No dishes yet. Pull the menu in Settings first."}
        </p>
      )}

      {shown.map((m) => {
        const uses = dishes.get(m.ingredientText) ?? [];
        const sample = uses[0];
        const searching = searchKey === m.ingredientText;
        const suggestions = sample
          ? suggestCnf(sample, 6).filter((s) => s.code !== m.foodCode)
          : [];
        const results = searching && q ? searchCnf(q, 12) : [];
        return (
          <section key={m.id} className="card space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-medium">{sample?.name ?? m.ingredientText}</h2>
              <span className={`shrink-0 text-xs ${m.confirmed ? "text-good" : "text-warn"}`}>
                {m.confirmed ? "✓ confirmed" : "to review"}
              </span>
            </div>
            <p className="text-sm">
              {m.foodName ? (
                <>
                  {m.foodName} <span className="tabular-nums text-muted">· {m.mgPer100g} mg/100 g</span>
                </>
              ) : (
                <span className="text-muted">No match: potassium unknown</span>
              )}
            </p>
            {uses.length > 0 && (
              <p className="text-xs text-muted">
                {uses
                  .slice(0, 3)
                  .map((u) => `${u.servingSize} → ${u.kMgEst == null ? "?" : `~${u.kMgEst} mg`}`)
                  .join(" · ")}
              </p>
            )}

            <div className="flex gap-2">
              {!m.confirmed && m.foodCode != null && (
                <form action={confirmKMatch.bind(null, m.ingredientText)} className="flex-1">
                  <Submit className="btn-primary w-full text-sm">✓ Looks right</Submit>
                </form>
              )}
            </div>

            <details open={searching}>
              <summary className="cursor-pointer text-sm text-accent">Change…</summary>
              <ul className="mt-2 space-y-1">
                {[...results, ...(results.length ? [] : suggestions)].map((s) => (
                  <li key={s.code}>
                    <form action={changeKMatch.bind(null, m.ingredientText, s.code)}>
                      <Submit className="w-full rounded-lg border border-line px-3 py-1.5 text-left text-sm">
                        {s.name} <span className="tabular-nums text-muted">· {s.mgPer100g} mg/100 g</span>
                      </Submit>
                    </form>
                  </li>
                ))}
                {searching && q && !results.length && <li className="text-sm text-muted">No CNF foods match “{q}”.</li>}
              </ul>
              <form className="mt-2 flex gap-2" action="/settings/potassium">
                <input type="hidden" name="key" value={m.ingredientText} />
                {showAll && <input type="hidden" name="show" value="all" />}
                <input
                  name="q"
                  defaultValue={searching ? q : ""}
                  placeholder="Search CNF, e.g. chicken breast roasted"
                  className="field flex-1"
                />
                <button className="btn">Search</button>
              </form>
              {m.foodCode != null && (
                <form action={changeKMatch.bind(null, m.ingredientText, null)} className="mt-2">
                  <Submit className="text-xs text-muted underline">No good match (leave potassium unknown)</Submit>
                </form>
              )}
            </details>
          </section>
        );
      })}

      <p className="text-center text-xs text-muted">
        Source: Canadian Nutrient File 2015, Health Canada (Open Government Licence – Canada).
      </p>
    </div>
  );
}
