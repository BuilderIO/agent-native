/**
 * `createScorer` and a batteries-included set of built-in scorers.
 *
 * A scorer is a 4-step pipeline (preprocess → analyze → generateScore →
 * generateReason). `createScorer` is a thin identity-with-validation factory:
 * it enforces the one hard contract (`generateScore` is required) and returns
 * a fully-typed `Scorer`. Built-in scorers below show both flavors:
 *
 *   - `exactMatch` / `contains` — pure-JS analyze, no model.
 *   - `llmJudge` — analyze runs an LLM judge through the resolved engine
 *     (provider-agnostic; the model is whatever the runner resolved).
 */

import type { AgentRunOutput, Scorer, ScorerDefinition } from "./types.js";

/**
 * Create a scorer from a 4-step pipeline definition.
 *
 * `generateScore` is the only required step. `preprocess`/`analyze` default to
 * identity (the scorer sees the raw `AgentRunOutput`), and `generateReason` is
 * optional.
 */
export function createScorer<Pre = AgentRunOutput, Ana = Pre>(
  def: ScorerDefinition<Pre, Ana>,
): Scorer<Pre, Ana> {
  if (!def.name || typeof def.name !== "string") {
    throw new Error("createScorer: `name` is required");
  }
  if (typeof def.generateScore !== "function") {
    throw new Error(
      `createScorer("${def.name}"): \`generateScore\` is required`,
    );
  }
  return {
    name: def.name,
    preprocess: def.preprocess,
    analyze: def.analyze,
    generateScore: def.generateScore,
    generateReason: def.generateReason,
  };
}

/** Clamp any number into [0, 1]; coerce non-finite to 0. */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// ─── Built-in JS scorers ──────────────────────────────────────────────

/** Normalize for forgiving text comparison (case + surrounding whitespace). */
function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * `exactMatch` — 1.0 when the agent's (trimmed, case-insensitive by default)
 * text equals `expected`, else 0.0. Pure JS, no model.
 */
export function exactMatch(
  expected: string,
  opts: { caseSensitive?: boolean } = {},
): Scorer<AgentRunOutput, { match: boolean }> {
  return createScorer<AgentRunOutput, { match: boolean }>({
    name: "exact_match",
    analyze(run) {
      const actual = opts.caseSensitive ? run.text.trim() : normalize(run.text);
      const want = opts.caseSensitive ? expected.trim() : normalize(expected);
      return { match: actual === want };
    },
    generateScore({ match }) {
      return match ? 1 : 0;
    },
    generateReason({ analysis }) {
      return analysis.match
        ? `Output exactly matched expected text`
        : `Output did not exactly match expected text`;
    },
  });
}

/**
 * `contains` — 1.0 when the agent's text contains every required substring
 * (case-insensitive by default). Score is the fraction matched, so a partial
 * hit still surfaces signal. Pure JS, no model.
 */
export function contains(
  needles: string | string[],
  opts: { caseSensitive?: boolean } = {},
): Scorer<AgentRunOutput, { found: string[]; missing: string[] }> {
  const list = (Array.isArray(needles) ? needles : [needles]).filter(Boolean);
  return createScorer<AgentRunOutput, { found: string[]; missing: string[] }>({
    name: "contains",
    analyze(run) {
      const hay = opts.caseSensitive ? run.text : run.text.toLowerCase();
      const found: string[] = [];
      const missing: string[] = [];
      for (const n of list) {
        const needle = opts.caseSensitive ? n : n.toLowerCase();
        if (hay.includes(needle)) found.push(n);
        else missing.push(n);
      }
      return { found, missing };
    },
    generateScore({ found }) {
      return list.length === 0 ? 1 : found.length / list.length;
    },
    generateReason({ analysis }) {
      if (analysis.missing.length === 0) {
        return `All ${list.length} required phrase(s) present`;
      }
      return `Missing: ${analysis.missing.join(", ")}`;
    },
  });
}

/**
 * `usesTool` — 1.0 when the agent invoked the named tool/action at least once.
 * Useful as a behavioral gate ("the agent must call send-email"). Pure JS.
 */
export function usesTool(
  toolName: string,
): Scorer<AgentRunOutput, { used: boolean }> {
  return createScorer<AgentRunOutput, { used: boolean }>({
    name: `uses_tool:${toolName}`,
    analyze(run) {
      return { used: run.toolCalls.includes(toolName) };
    },
    generateScore({ used }) {
      return used ? 1 : 0;
    },
    generateReason({ analysis }) {
      return analysis.used
        ? `Agent called \`${toolName}\``
        : `Agent never called \`${toolName}\``;
    },
  });
}

// ─── Built-in LLM-judge scorer ────────────────────────────────────────

interface JudgeVerdict {
  score: number;
  reasoning: string;
}

/**
 * Pull the first JSON object out of model text (which may be wrapped in prose
 * or a ```json fence) and parse it into a verdict. Returns null on garbage so
 * the caller can degrade gracefully instead of throwing.
 */
function parseJudgeVerdict(text: string): JudgeVerdict | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Partial<JudgeVerdict>;
    if (typeof parsed.score !== "number") return null;
    return {
      score: parsed.score,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch {
    return null;
  }
}

export interface LlmJudgeOptions {
  /** Scorer name (defaults to `llm_judge`). */
  name?: string;
  /** What is being judged, e.g. "helpfulness". */
  criteria: string;
  /** A rubric describing what 0.0 vs 1.0 means. */
  rubric?: string;
  /**
   * The score scale the judge is told to use. Output is normalized to [0,1].
   * Defaults to a 0..1 scale.
   */
  scoreRange?: { min: number; max: number };
}

/**
 * `llmJudge` — an LLM-as-judge scorer. The analyze step asks the resolved
 * engine to score the agent output against a natural-language rubric and emit
 * `{ "score": <n>, "reasoning": "<why>" }`. The model is whatever the runner
 * resolved from the engine registry — this scorer NEVER hardcodes a provider
 * or model, so evals stay provider-agnostic.
 */
export function llmJudge(
  opts: LlmJudgeOptions,
): Scorer<
  AgentRunOutput,
  { verdict: JudgeVerdict | null; normalized: number }
> {
  const min = opts.scoreRange?.min ?? 0;
  const max = opts.scoreRange?.max ?? 1;
  const name = opts.name ?? "llm_judge";

  return createScorer<
    AgentRunOutput,
    { verdict: JudgeVerdict | null; normalized: number }
  >({
    name,
    async analyze(run, ctx) {
      const prompt = `You are an expert evaluator. Score the agent output below against the criteria.

## Criteria
${opts.criteria}${opts.rubric ? `\n\n## Rubric\n${opts.rubric}` : ""}

## Agent Output
${run.text || "(no text output)"}

## Tools the agent used
${run.toolCalls.length ? run.toolCalls.join(", ") : "(none)"}

## Instructions
Respond with ONLY a JSON object (no markdown, no prose outside the JSON):
{"score": <number between ${min} and ${max}>, "reasoning": "<brief explanation>"}`;

      const text = await ctx.judge({
        systemPrompt:
          "You are an evaluation judge. Respond only with valid JSON.",
        prompt,
        maxOutputTokens: 512,
      });
      const verdict = parseJudgeVerdict(text);
      const normalized =
        verdict === null
          ? 0
          : max > min
            ? (verdict.score - min) / (max - min)
            : verdict.score;
      return { verdict, normalized };
    },
    generateScore({ normalized }) {
      return clamp01(normalized);
    },
    generateReason({ analysis }) {
      if (analysis.verdict === null) {
        return "Judge did not return a parseable verdict";
      }
      return analysis.verdict.reasoning || "(no reasoning provided)";
    },
  });
}
