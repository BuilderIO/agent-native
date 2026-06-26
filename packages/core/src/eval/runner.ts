/**
 * The evals runner: discover `*.eval.ts` / `evals/*.ts` files, run each eval
 * through its scorer pipeline against the *real* agent loop, score, and report.
 *
 * It is the engine behind `agent-native eval` — when used as a CI deploy gate
 * the CLI exits non-zero if any eval scores below its threshold.
 *
 * Two layers:
 *   - `scoreEval` / `runEvals` — pure orchestration over an `AgentRunner` and
 *     a list of evals. Fully unit-testable with an injected runner (no model).
 *   - `discoverEvalFiles` / `loadEvals` — filesystem discovery + dynamic import
 *     of author-written eval modules.
 *
 * Results are also (best-effort) written to the observability eval store so a
 * dashboard can surface CI eval history next to production run evals.
 */

import nodePath from "node:path";
import { pathToFileURL } from "node:url";

import type { ActionEntry } from "../agent/production-agent.js";
import { insertEvalResult } from "../observability/store.js";
import type { EvalResult as ObservabilityEvalResult } from "../observability/types.js";
import type { AgentRunner } from "./agent-runner.js";
import { createAgentRunner } from "./agent-runner.js";
import { DEFAULT_EVAL_THRESHOLD } from "./define-eval.js";
import { clamp01 } from "./scorer.js";
import type {
  AgentRunOutput,
  Eval,
  EvalResultRow,
  EvalRunReport,
  ScorerResult,
} from "./types.js";

// ─── Scoring orchestration ────────────────────────────────────────────

/** Run one scorer's pipeline (preprocess → analyze → score → reason). */
async function runScorer(
  scorer: Eval["scorers"][number],
  run: AgentRunOutput,
  runner: AgentRunner,
  threshold: number,
): Promise<ScorerResult> {
  try {
    const pre = scorer.preprocess ? await scorer.preprocess(run) : run;
    const analysis = scorer.analyze
      ? await scorer.analyze(pre as never, runner.analyzeContext())
      : pre;
    const rawScore = await scorer.generateScore(analysis as never);
    const score = clamp01(rawScore);
    const reason = scorer.generateReason
      ? await scorer.generateReason({
          run,
          analysis: analysis as never,
          score,
        })
      : undefined;
    return { scorer: scorer.name, score, reason, passed: score >= threshold };
  } catch (err) {
    // A scorer that throws is a failed scorer, not a crashed run — degrade
    // gracefully so one bad scorer can't take down the whole CI gate.
    return {
      scorer: scorer.name,
      score: 0,
      reason: `Scorer errored: ${err instanceof Error ? err.message : String(err)}`,
      passed: false,
    };
  }
}

/** Run a single eval: invoke the agent, then score with each scorer. */
export async function scoreEval(
  evalCase: Eval,
  runner: AgentRunner,
  opts: { thresholdOverride?: number } = {},
): Promise<EvalResultRow> {
  const threshold =
    opts.thresholdOverride ?? evalCase.threshold ?? DEFAULT_EVAL_THRESHOLD;

  let run: AgentRunOutput;
  if (evalCase.run) {
    run = await evalCase.run({
      input: evalCase.input,
      runAgent: (input) => runner.runAgent(input),
    });
  } else {
    run = await runner.runAgent(evalCase.input);
  }

  const scores: ScorerResult[] = [];
  for (const scorer of evalCase.scorers) {
    scores.push(await runScorer(scorer, run, runner, threshold));
  }

  const avgScore =
    scores.length > 0
      ? scores.reduce((s, r) => s + r.score, 0) / scores.length
      : 0;

  return {
    eval: evalCase.name,
    threshold,
    scores,
    // A run that errored, or any sub-threshold scorer, fails the case.
    passed: run.ok && scores.every((s) => s.passed),
    avgScore,
    durationMs: run.durationMs,
    error: run.ok ? undefined : run.error,
  };
}

/** Run a batch of evals against one runner and aggregate a report. */
export async function runEvals(
  evals: Eval[],
  runner: AgentRunner,
  opts: { thresholdOverride?: number; persist?: boolean } = {},
): Promise<EvalRunReport> {
  const results: EvalResultRow[] = [];
  for (const evalCase of evals) {
    const row = await scoreEval(evalCase, runner, opts);
    results.push(row);
    if (opts.persist) await persistEvalRow(row).catch(() => {});
  }

  const passed = results.filter((r) => r.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}

/**
 * Best-effort write of one eval result to the observability eval store so a
 * dashboard can show CI eval history alongside production run evals. We write
 * one row per (eval × scorer), tagged `evalType: "automated"` with a synthetic
 * `eval:` run id.
 *
 * TODO(live-sampling): the same scorer list should also run on a sampled
 * fraction of *real* production runs. That hook belongs in the agent loop's
 * (not-yet-added) post-run processor seam: when a run finishes, roll the
 * configured sample rate and, if it hits, replay the run output through these
 * scorers and write the rows here. Wiring it now would require the in-loop
 * processor seam another wave is adding — so this is the single intended
 * attachment point, intentionally left as a note.
 */
async function persistEvalRow(row: EvalResultRow): Promise<void> {
  const runId = `eval:${row.eval}:${Date.now()}`;
  for (const s of row.scores) {
    const result: ObservabilityEvalResult = {
      id: crypto.randomUUID(),
      runId,
      threadId: null,
      userId: null,
      evalType: "automated",
      criteria: `eval:${row.eval}:${s.scorer}`,
      score: s.score,
      reasoning: s.reason ?? null,
      metadata: {
        source: "cli-eval",
        threshold: row.threshold,
        passed: s.passed,
      },
      createdAt: Date.now(),
    };
    await insertEvalResult(result);
  }
}

// ─── Discovery + loading ──────────────────────────────────────────────

const EVAL_FILE_RE = /\.eval\.(ts|js|mjs)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".output", "build"]);

/**
 * Walk `root` for eval files. Matches two conventions:
 *   - any `**\/*.eval.ts` (co-located with code), and
 *   - any `*.ts` directly inside an `evals/` directory.
 * `pattern` further filters by substring of the relative path.
 */
export async function discoverEvalFiles(
  root: string,
  pattern?: string,
): Promise<string[]> {
  const fs = await import("node:fs");
  const out: string[] = [];

  function isEvalFile(full: string, parentName: string): boolean {
    const base = nodePath.basename(full);
    if (EVAL_FILE_RE.test(base)) return true;
    if (parentName === "evals" && /\.(ts|js|mjs)$/.test(base)) {
      // Skip obvious support files inside evals/.
      return !/\.(spec|test|d)\.(ts|js|mjs)$/.test(base);
    }
    return false;
  }

  function walk(dir: string, parentName: string): void {
    let entries: import("node:fs").Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(full, entry.name);
      } else if (entry.isFile() && isEvalFile(full, parentName)) {
        out.push(full);
      }
    }
  }

  walk(root, nodePath.basename(root));
  out.sort();

  if (!pattern) return out;
  return out.filter((f) => nodePath.relative(root, f).includes(pattern));
}

/** Pull `Eval` definitions out of a dynamically-imported eval module. */
function extractEvals(mod: Record<string, unknown>): Eval[] {
  const candidates: unknown[] = [];
  if (mod.default !== undefined) candidates.push(mod.default);
  for (const [key, value] of Object.entries(mod)) {
    if (key === "default") continue;
    candidates.push(value);
  }

  const evals: Eval[] = [];
  for (const c of candidates.flat()) {
    if (
      c &&
      typeof c === "object" &&
      typeof (c as Eval).name === "string" &&
      Array.isArray((c as Eval).scorers) &&
      (c as Eval).input
    ) {
      evals.push(c as Eval);
    }
  }
  return evals;
}

/** Discover and import all eval files under `root`, returning their evals. */
export async function loadEvals(
  root: string,
  pattern?: string,
): Promise<{ files: string[]; evals: Eval[] }> {
  const files = await discoverEvalFiles(root, pattern);
  const evals: Eval[] = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(file).href)) as Record<
      string,
      unknown
    >;
    evals.push(...extractEvals(mod));
  }
  return { files, evals };
}

// ─── High-level entry used by the CLI ─────────────────────────────────

export interface RunEvalSuiteOptions {
  /** App root to discover eval files + actions under. Defaults to cwd. */
  cwd?: string;
  /** Substring filter on the eval file path. */
  pattern?: string;
  /** Global threshold override (wins over per-eval thresholds). */
  thresholdOverride?: number;
  /** App actions to expose to the agent. Auto-discovered when omitted. */
  actions?: Record<string, ActionEntry>;
  /** System prompt for runs. */
  systemPrompt?: string;
  /** Write results to the observability eval store (default true). */
  persist?: boolean;
  /** Pre-built runner (tests inject this to avoid touching engine/loop). */
  runner?: AgentRunner;
  /** Pre-loaded evals (tests inject this to skip filesystem discovery). */
  evals?: Eval[];
}

/**
 * End-to-end: load evals, build a runner, score, report. The CLI wraps this
 * and maps `report.failed > 0` to a non-zero exit code (the CI gate).
 */
export async function runEvalSuite(
  opts: RunEvalSuiteOptions = {},
): Promise<{ report: EvalRunReport; files: string[] }> {
  const cwd = opts.cwd ?? process.cwd();

  let files: string[] = [];
  let evals = opts.evals;
  if (!evals) {
    const loaded = await loadEvals(cwd, opts.pattern);
    files = loaded.files;
    evals = loaded.evals;
  }

  const runner =
    opts.runner ??
    (await createAgentRunner({
      actions: opts.actions ?? (await discoverActions(cwd)),
      systemPrompt: opts.systemPrompt,
    }));

  const report = await runEvals(evals, runner, {
    thresholdOverride: opts.thresholdOverride,
    persist: opts.persist ?? true,
  });
  return { report, files };
}

/**
 * Discover the app's actions so the agent under test has the real tool
 * surface. Lazy-imports `autoDiscoverActions` to keep server-only deps out of
 * any browser bundle that might touch this module's types.
 */
async function discoverActions(
  cwd: string,
): Promise<Record<string, ActionEntry>> {
  try {
    const { autoDiscoverActions } =
      await import("../server/action-discovery.js");
    const actionsDir = nodePath.join(cwd, "actions");
    return await autoDiscoverActions(pathToFileURL(actionsDir + "/").href);
  } catch {
    return {};
  }
}
