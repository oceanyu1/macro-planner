import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { buildPlanPrompt, checkLlmPlan, PlanOutput, revisionPrompt, SYSTEM_PROMPT, type RecentMeals } from "./llm-plan";
import type { DayPlan, PlanInput, PlanMeal } from "./planner";

export const LLM_MODEL = "claude-sonnet-5-5";
/** One first attempt plus 2 revisions, then the caller falls back to the greedy planner. */
const MAX_ATTEMPTS = 3;
/** Don't start another revision after this long: the caller is a 60–300 s serverless function. */
const START_CUTOFF_MS = 60_000;

export type LlmPlanResult =
  | { ok: true; day: DayPlan; notes: Record<PlanMeal, string>; attempts: number }
  | { ok: false; reason: string; attempts: number };

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  // 60 s per request, one SDK retry on 429/5xx. A day plan normally takes 10–30 s.
  client ??= new Anthropic({ timeout: 60_000, maxRetries: 1 });
  return client;
}

/**
 * Ask Claude for a day plan, check it against the menu and targets in code, and
 * send the problems back for up to 2 revisions. Never returns a plan that
 * misses a target or breaks a rule: `ok: false` means "use the greedy planner".
 */
export async function planDayWithClaude(input: PlanInput, recent: RecentMeals = []): Promise<LlmPlanResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: "ANTHROPIC_API_KEY is not set", attempts: 0 };

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildPlanPrompt(input, recent) }];
  let lastProblems: string[] = [];
  const t0 = Date.now();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1 && Date.now() - t0 > START_CUTOFF_MS)
      return { ok: false, reason: `out of time after ${attempt - 1} attempts: ${lastProblems.join(" ")}`, attempts: attempt - 1 };
    let response;
    try {
      response = await anthropic().messages.parse({
        model: LLM_MODEL,
        max_tokens: 16000,
        // The system prompt and the first user turn (the menu) stay the same across revisions, so they cache.
        cache_control: { type: "ephemeral" },
        system: SYSTEM_PROMPT,
        output_config: { effort: "medium", format: zodOutputFormat(PlanOutput) },
        messages,
      });
    } catch (err) {
      return { ok: false, reason: `API error: ${apiErrorText(err)}`, attempts: attempt };
    }

    if (response.stop_reason === "refusal") return { ok: false, reason: "model declined", attempts: attempt };
    if (response.stop_reason === "max_tokens") return { ok: false, reason: "response cut off", attempts: attempt };
    const out = response.parsed_output;
    if (!out) return { ok: false, reason: "no parseable plan", attempts: attempt };

    const check = checkLlmPlan(out, input);
    if (!check.problems.length) return { ok: true, day: check.day, notes: check.notes, attempts: attempt };

    lastProblems = check.problems;
    // Append-only history: Claude's full turn (thinking blocks included), then the problems.
    messages.push({ role: "assistant", content: response.content as Anthropic.ContentBlockParam[] });
    messages.push({ role: "user", content: revisionPrompt(check.problems, check.day) });
  }
  return { ok: false, reason: `still off target after revisions: ${lastProblems.join(" ")}`, attempts: MAX_ATTEMPTS };
}

function apiErrorText(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "invalid API key";
  if (err instanceof Anthropic.RateLimitError) return "rate limited";
  if (err instanceof Anthropic.APIError) return `${err.status ?? ""} ${err.message}`.trim();
  return (err as Error).message;
}
