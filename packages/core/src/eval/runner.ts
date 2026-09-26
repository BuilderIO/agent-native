
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
    return {
      scorer: scorer.name,
      score: 0,
      reason: `Scorer errored: ${err instanceof Error ? err.message : String(err)}`,
      passed: false,
    };
  }
}

export async function scoreEval(
  evalCase: Eval,
  runner: AgentRunner,
  opts: { thresholdOverride?: number } = {},
): Promise<EvalResultRow> {
  const threshold =
    opts.thresholdOverride ?? evalCase.threshold ?? DEFAULT_EVAL_THRESHOLD;

  if (evalCase.skipReason) {
    return {
      eval: evalCase.name,
      threshold,
      scores: [],
      status: "skipped",
      skipReason: evalCase.skipReason,
      passed: true,
      avgScore: 0,
      durationMs: 0,
    };
  }

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
    passed: run.ok && scores.every((s) => s.passed),
    status: run.ok && scores.every((s) => s.passed) ? "passed" : "failed",
    avgScore,
    durationMs: run.durationMs,
    error: run.ok ? undefined : run.error,
  };
}

export async function runEvals(
  evals: Eval[],
  runner: AgentRunner,
  opts: { thresholdOverride?: number; persist?: boolean } = {},
): Promise<EvalRunReport> {
  const results: EvalResultRow[] = [];
  for (const evalCase of evals) {
    const row = await scoreEval(evalCase, runner, opts);
    results.push(row);
    if (opts.persist && row.status !== "skipped") {
      await persistEvalRow(row).catch(() => {});
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  return {
    total: results.length,
    passed,
    failed: results.filter((r) => r.status !== "skipped" && !r.passed).length,
    skipped,
    results,
  };
}

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


const EVAL_FILE_RE = /\.eval\.(ts|js|mjs)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".output", "build"]);

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


export interface RunEvalSuiteOptions {
  cwd?: string;
  pattern?: string;
  thresholdOverride?: number;
  actions?: Record<string, ActionEntry>;
  systemPrompt?: string;
  persist?: boolean;
  runner?: AgentRunner;
  evals?: Eval[];
}

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

  const needsRunner = evals.some((evalCase) => !evalCase.skipReason);
  const runner =
    opts.runner ??
    (needsRunner
      ? await createAgentRunner({
          actions: opts.actions ?? (await discoverActions(cwd)),
          systemPrompt: opts.systemPrompt,
        })
      : createInertRunner());

  const report = await runEvals(evals, runner, {
    thresholdOverride: opts.thresholdOverride,
    persist: opts.persist ?? true,
  });
  return { report, files };
}

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

function createInertRunner(): AgentRunner {
  return {
    engine: {} as AgentRunner["engine"],
    model: "inert",
    async runAgent() {
      throw new Error("Eval unexpectedly requested the agent runner");
    },
    analyzeContext() {
      throw new Error("Eval unexpectedly requested analyze context");
    },
  };
}
