"use client";

import { useActionState } from "react";
import { pullMenu } from "@/app/actions";

/** "Pull menu now": runs the 7-day ingest and shows the one-line result. Takes ~20–60 s. */
export function PullMenuButton() {
  const [result, action, pending] = useActionState(pullMenu, null);
  return (
    <form action={action} className="space-y-2">
      <button type="submit" disabled={pending} className="btn w-full">
        {pending ? "Pulling 7 days… (up to a minute)" : "Pull menu now"}
      </button>
      {result && <p className="text-xs text-muted">{result}</p>}
    </form>
  );
}
