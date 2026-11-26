import {
  addApplication,
  addMilestone,
  deleteApplication,
  deleteMilestone,
  setApplicationStatus,
  toggleMilestone,
} from "@/app/actions";
import { AutoSubmitSelect, Submit } from "@/components/ui";
import { applicationStatusEnum } from "@/db/schema";
import { prettyDate, today } from "@/lib/dates";
import { getApplications, getMilestones } from "@/lib/data";
import { requireUser } from "@/lib/session";

const STATUSES = applicationStatusEnum.enumValues;

export default async function GoalsPage() {
  await requireUser();
  const [apps, milestones] = await Promise.all([getApplications(), getMilestones()]);
  const now = today();
  const projects = [...new Set(milestones.map((m) => m.project))];
  const counts = Object.fromEntries(STATUSES.map((s) => [s, apps.filter((a) => a.status === s).length]));

  return (
    <div className="space-y-4 lg:max-w-2xl">
      <h1 className="text-lg font-semibold">Long goals</h1>

      {/* internships */}
      <section className="card space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="h2">Internship applications</h2>
          <span className="text-xs text-muted">
            {apps.length} total · {counts.interview} interview · {counts.offer} offer
          </span>
        </div>

        <ul className="divide-y divide-line">
          {apps.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {a.link ? (
                    <a href={a.link} target="_blank" rel="noreferrer" className="text-accent">
                      {a.company}
                    </a>
                  ) : (
                    a.company
                  )}
                </div>
                <div className="truncate text-xs text-muted">
                  {a.role}
                  {a.appliedOn && ` · ${prettyDate(a.appliedOn)}`}
                </div>
              </div>
              <form action={async (fd: FormData) => {
                "use server";
                await setApplicationStatus(a.id, String(fd.get("status")));
              }}>
                <AutoSubmitSelect name="status" defaultValue={a.status} className="field w-auto py-1 text-xs">
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </AutoSubmitSelect>
              </form>
              <form action={deleteApplication.bind(null, a.id)}>
                <Submit className="px-1 text-muted" aria-label={`Delete ${a.company}`}>
                  ✕
                </Submit>
              </form>
            </li>
          ))}
          {!apps.length && <li className="py-2 text-sm text-muted">No applications yet.</li>}
        </ul>

        <details>
          <summary className="cursor-pointer text-sm text-accent">Add application…</summary>
          <form action={addApplication} className="mt-3 grid grid-cols-2 gap-2">
            <input name="company" required placeholder="Company" className="field" />
            <input name="role" required placeholder="Role" className="field" />
            <select name="status" defaultValue="applied" className="field">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input name="appliedOn" type="date" defaultValue={now} className="field" />
            <input name="link" type="url" placeholder="Posting URL (optional)" className="field col-span-2" />
            <Submit className="btn-primary col-span-2">Add</Submit>
          </form>
        </details>
      </section>

      {/* milestones */}
      {projects.map((p) => {
        const ms = milestones.filter((m) => m.project === p);
        const doneCount = ms.filter((m) => m.done).length;
        return (
          <section key={p} className="card">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="h2">{p}</h2>
              <span className="text-xs text-muted">
                {doneCount} / {ms.length}
              </span>
            </div>
            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-good" style={{ width: `${(doneCount / ms.length) * 100}%` }} />
            </div>
            <ul className="space-y-1">
              {ms.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-sm">
                  <form action={toggleMilestone.bind(null, m.id, now)} className="flex-1">
                    <Submit className="flex w-full items-center gap-2 py-1 text-left">
                      <span
                        className={`grid size-5 shrink-0 place-items-center rounded border text-xs ${m.done ? "border-good bg-good text-white" : "border-muted"}`}
                      >
                        {m.done ? "✓" : ""}
                      </span>
                      <span className={m.done ? "text-muted line-through" : ""}>{m.title}</span>
                      {m.dueDate && !m.done && (
                        <span className={`ml-auto text-xs ${m.dueDate < now ? "text-bad" : "text-muted"}`}>
                          {prettyDate(m.dueDate)}
                        </span>
                      )}
                    </Submit>
                  </form>
                  <form action={deleteMilestone.bind(null, m.id)}>
                    <Submit className="px-1 text-muted" aria-label={`Delete ${m.title}`}>
                      ✕
                    </Submit>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section className="card">
        <details open={!projects.length}>
          <summary className="cursor-pointer text-sm text-accent">Add milestone…</summary>
          <form action={addMilestone} className="mt-3 grid grid-cols-2 gap-2">
            <input
              name="project"
              required
              list="projects"
              placeholder="Project (Roblox, …)"
              className="field"
            />
            <datalist id="projects">
              {[...new Set(["Roblox", "Side project", ...projects])].map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <input name="dueDate" type="date" className="field" />
            <input name="title" required placeholder="Milestone" className="field col-span-2" />
            <Submit className="btn-primary col-span-2">Add</Submit>
          </form>
        </details>
      </section>
    </div>
  );
}
