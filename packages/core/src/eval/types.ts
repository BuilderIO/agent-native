/**
 * Types for the first-class evals primitive.
 *
 * This is a *test-case* eval system (define a prompt + expected behavior,
 * actually run the agent, score the output) — distinct from the post-hoc
 * run-scoring engine in `../observability/evals.ts`, which scores already-
 * completed production runs. The two are complementary:
 *
 *   - `observability/evals.ts` — "how did this real run do?" (passive,
 *     sampled, lives next to traces).
 *   - `eval/*` (this module) — "does the agent do the right thing on this
 *     fixed input?" (active, deterministic CI gate, run via the CLI).
 *
 * The pipeline shape (preprocess → analyze → generateScore → generateReason)
 * is borrowed from Mastra's scorer design: each scorer is a small, composable
 * 4-step pipeline so a single scorer can mix plain-JS checks with an LLM
 * judge while still producing one normalized 0..1 number plus a reason.
 */

import type { AgentEngine } from "../agent/engine/types.js";

// ─── Agent run output ─────────────────────────────────────────────────

/**
 * The result of actually running the agent loop for one eval input. Scorers
 * receive this as the thing under test. It is intentionally small and
 * transport-agnostic so a scorer never reaches into framework internals.
 */
export interface AgentRunOutput {
  /** Concatenated assistant text emitted across the run. */
  readonly text: string;
  /** Names of tools/actions the agent invoked, in call order. */
  readonly toolCalls: readonly string[];
  /** Whether the run completed without a terminal error event. */
  readonly ok: boolean;
  /** Terminal error message, if the run errored. */
  readonly error?: string;
  /** Synthetic run id, useful for writing eval rows to the observability store. */
  readonly runId: string;
  /** Wall-clock duration of the run in milliseconds. */
  readonly durationMs: number;
}

// ─── Scorer pipeline ──────────────────────────────────────────────────

/**
 * Context handed to a scorer's analyze step when it needs an LLM judge. The
 * engine/model are resolved by the runner from the existing engine registry —
 * a scorer NEVER hardcodes a provider or model, keeping evals provider-
 * agnostic. `judge()` is a convenience that streams a single judging turn and
 * returns the raw model text.
 */
export interface ScorerAnalyzeContext {
  /** The resolved, provider-agnostic engine for LLM-judge scorers. */
  readonly engine: AgentEngine;
  /** The resolved model string for the engine. */
  readonly model: string;
  /**
   * Run a single LLM judging turn. Returns the model's raw text output. Used
   * by `llmJudge` and any custom LLM-backed analyze step. Provider-agnostic —
   * the engine is whatever the app/CLI resolved.
   */
  judge(opts: {
    systemPrompt?: string;
    prompt: string;
    maxOutputTokens?: number;
    signal?: AbortSignal;
  }): Promise<string>;
}

/**
 * A 4-step scoring pipeline (Mastra-style):
 *
 *   preprocess(run)      → x        (transform the run/output; optional)
 *   analyze(x, ctx)      → analysis (plain JS OR an LLM judge; optional)
 *   generateScore(a)     → 0..1     (REQUIRED, normalized)
 *   generateReason(...)  → string   (human-readable why; optional)
 *
 * Generics flow `Pre` (preprocess output) → `Ana` (analyze output) so a
 * single scorer is fully typed end-to-end.
 */
export interface Scorer<Pre = AgentRunOutput, Ana = Pre> {
  readonly name: string;
  preprocess?(run: AgentRunOutput): Pre | Promise<Pre>;
  analyze?(input: Pre, ctx: ScorerAnalyzeContext): Ana | Promise<Ana>;
  /** REQUIRED. Returns a normalized score in [0, 1]. */
  generateScore(analysis: Ana): number | Promise<number>;
  generateReason?(args: {
    run: AgentRunOutput;
    analysis: Ana;
    score: number;
  }): string | Promise<string>;
}

/** Definition object passed to `createScorer`. */
export interface ScorerDefinition<Pre = AgentRunOutput, Ana = Pre> {
  name: string;
  preprocess?(run: AgentRunOutput): Pre | Promise<Pre>;
  analyze?(input: Pre, ctx: ScorerAnalyzeContext): Ana | Promise<Ana>;
  generateScore(analysis: Ana): number | Promise<number>;
  generateReason?(args: {
    run: AgentRunOutput;
    analysis: Ana;
    score: number;
  }): string | Promise<string>;
}

// ─── Eval definition ──────────────────────────────────────────────────

/** The prompt + optional setup that drives one eval case. */
export interface EvalInput {
  /** The user prompt / message sent to the agent. */
  prompt: string;
  /**
   * Optional prior conversation turns to seed before `prompt`. Each is a
   * plain { role, text } pair; the runner converts them to engine messages.
   */
  history?: Array<{ role: "user" | "assistant"; text: string }>;
}

/** Context passed to an eval's optional `run` override. */
export interface EvalRunContext {
  readonly input: EvalInput;
  /** The default agent runner — invoke it to run the agent loop as a caller. */
  runAgent(input: EvalInput): Promise<AgentRunOutput>;
}

/**
 * A named eval = one test case. `scorers` produce per-scorer rows; the case
 * passes when EVERY scorer meets `threshold` (default 0.5, overridable per
 * eval and globally from the CLI).
 */
export interface Eval {
  name: string;
  input: EvalInput;
  /**
   * Optional override for how the agent is run for this case. Defaults to the
   * runner's headless `runAgent`. Use this to do custom setup (seed data,
   * multi-turn) before/after the agent call.
   */
  run?(ctx: EvalRunContext): AgentRunOutput | Promise<AgentRunOutput>;
  scorers: Scorer<any, any>[];
  /** Minimum acceptable score (per scorer) in [0, 1]. Default 0.5. */
  threshold?: number;
}

// ─── Results ──────────────────────────────────────────────────────────

/** One result row per (eval × scorer). Stores both the number AND the reason. */
export interface ScorerResult {
  scorer: string;
  score: number;
  reason?: string;
  passed: boolean;
}

/** Aggregated result for a single eval (all of its scorers). */
export interface EvalResultRow {
  eval: string;
  threshold: number;
  scores: ScorerResult[];
  /** True only when every scorer passed. */
  passed: boolean;
  /** Mean of the scorer scores, for at-a-glance ranking. */
  avgScore: number;
  durationMs: number;
  /** Terminal error if the agent run itself failed. */
  error?: string;
}

/** The full runner report. */
export interface EvalRunReport {
  total: number;
  passed: number;
  failed: number;
  results: EvalResultRow[];
}
