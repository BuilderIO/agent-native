/**
 * `agent-native eval [pattern] [--json] [--threshold N]`
 * `agent-native eval promote <runId> [--write path] [--json] [--must-contain text]`
 *
 * Discover the app's `*.eval.ts` / `evals/*.ts` files, actually run the agent
 * for each eval input, score the output with the eval's scorers, print a
 * readable scored table, and EXIT NON-ZERO if any eval scores below its
 * threshold. That non-zero exit makes the command a drop-in CI deploy gate:
 *
 *   - run: agent-native eval                 (block deploy on regressions)
 *   - or:  agent-native eval --json          (machine-readable for CI)
 *   - or:  agent-native eval promote <runId> --write evals/from-trace.eval.ts
 *
 * The runner resolves a provider-agnostic engine/model from the existing
 * registry — no model is hardcoded — so the same suite runs against whatever
 * engine the app is configured for.
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export type EvalRunCliArgs = {
  command: "run";
  pattern?: string;
  json: boolean;
  threshold?: number;
};

export type EvalPromoteCliArgs = {
  command: "promote";
  runId: string;
  write?: string;
  json: boolean;
  mustContain?: string;
  datasetName?: string;
};

export type ParsedEvalArgs = EvalRunCliArgs | EvalPromoteCliArgs;

function takeValue(
  argv: string[],
  i: number,
  flag: string,
): { value: string; next: number } | null {
  const arg = argv[i];
  if (arg === flag && argv[i + 1] !== undefined) {
    return { value: argv[i + 1]!, next: i + 1 };
  }
  if (arg.startsWith(`${flag}=`)) {
    return { value: arg.slice(`${flag}=`.length), next: i };
  }
  return null;
}

function printHelp(): void {
  console.log(`agent-native eval — run agent evals as a CI deploy gate

Usage:
  agent-native eval [pattern] [--json] [--threshold N]
  agent-native eval promote <runId> [--write path] [--json] [--must-contain text]

Discovers **/*.eval.ts and evals/*.ts under the current app, runs the agent
for each eval input, scores the output with the eval's scorers, and exits
non-zero if any eval scores below its threshold (so it gates CI/deploys).

promote maps a completed production run into a defineEval case, persists an
EvalDataset row, and optionally writes a *.eval.ts the CI gate already
discovers. The hosted action never writes files. Repeating a promotion
returns the existing dataset. A run whose event history exceeds the
promotion limit is refused (events_truncated) instead of emitting a partial
eval. With --write, the fixture is written before the dataset row is
inserted; a failed write leaves no new dataset.

Arguments:
  pattern            Only run eval files whose path contains this substring.
  runId              Completed observability run id to promote.

Options:
  --json             Emit a machine-readable JSON report (for CI).
  --threshold N      Override every eval's pass threshold (0..1).
  --write path       Write a loadable *.eval.ts for the promoted case.
  --must-contain txt Optional contains() needle for the promoted case.
  --dataset-name n   Optional EvalDataset name (defaults to from-trace:<runId>).
  -h, --help         Show this help.

Authoring (evals/example.eval.ts):
  import { defineEval, contains, llmJudge } from "@agent-native/core/eval";
  export default defineEval({
    name: "answers the FAQ",
    input: { prompt: "What is your return policy?" },
    threshold: 0.7,
    scorers: [contains("30 days"), llmJudge({ criteria: "accuracy" })],
  });`);
}

/** Parse `[pattern] [--json] [--threshold N]` or `promote <runId> ...`. */
export function parseEvalArgs(argv: string[]): ParsedEvalArgs {
  if (argv[0] === "promote") {
    let runId: string | undefined;
    let write: string | undefined;
    let json = false;
    let mustContain: string | undefined;
    let datasetName: string | undefined;

    for (let i = 1; i < argv.length; i += 1) {
      const arg = argv[i]!;
      if (arg === "--json") {
        json = true;
        continue;
      }
      if (arg === "--help" || arg === "-h") {
        printHelp();
        process.exit(0);
      }
      const writeVal = takeValue(argv, i, "--write");
      if (writeVal) {
        write = writeVal.value;
        i = writeVal.next;
        continue;
      }
      const containVal = takeValue(argv, i, "--must-contain");
      if (containVal) {
        mustContain = containVal.value;
        i = containVal.next;
        continue;
      }
      const datasetVal = takeValue(argv, i, "--dataset-name");
      if (datasetVal) {
        datasetName = datasetVal.value;
        i = datasetVal.next;
        continue;
      }
      if (!arg.startsWith("-") && runId === undefined) {
        runId = arg;
      }
    }

    if (!runId) {
      console.error("eval promote: <runId> is required");
      process.exit(2);
    }
    if (write !== undefined && write.length === 0) {
      console.error("eval promote: --write requires a path");
      process.exit(2);
    }

    return {
      command: "promote",
      runId,
      json,
      ...(write ? { write } : {}),
      ...(mustContain ? { mustContain } : {}),
      ...(datasetName ? { datasetName } : {}),
    };
  }

  let pattern: string | undefined;
  let json = false;
  let threshold: number | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--json") {
      json = true;
    } else if (arg === "--threshold" && argv[i + 1] !== undefined) {
      threshold = Number(argv[++i]);
    } else if (arg.startsWith("--threshold=")) {
      threshold = Number(arg.slice("--threshold=".length));
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-") && pattern === undefined) {
      pattern = arg;
    }
  }

  if (
    threshold !== undefined &&
    (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
  ) {
    console.error("eval: --threshold must be a number in [0, 1]");
    process.exit(2);
  }

  return { command: "run", pattern, json, threshold };
}

async function writePromotedEvalFile(
  writePath: string,
  source: string,
): Promise<void> {
  const target = path.resolve(process.cwd(), writePath);
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  // Write aside the destination so a failed write cannot truncate a fixture
  // that is already there, and cannot run after the dataset insert.
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.tmp`);
  try {
    await fs.writeFile(tmp, source, "utf8");
    await fs.rename(tmp, target);
  } catch (err) {
    try {
      await fs.rm(tmp, { force: true });
    } catch {
      // coercion-ok: temp-file cleanup is best-effort; the write error is rethrown.
    }
    throw err;
  }
}

async function runPromote(args: EvalPromoteCliArgs): Promise<void> {
  const { loadTraceEvalPromotion, persistPromotedEvalDataset } =
    await import("../observability/actions/promote-trace-eval.js");
  const { generateEvalModuleSource } = await import("../eval/from-trace.js");

  let result: Awaited<ReturnType<typeof loadTraceEvalPromotion>>["promotion"];
  try {
    const loaded = await loadTraceEvalPromotion({
      runId: args.runId,
      mustContain: args.mustContain,
      datasetName: args.datasetName,
    });
    // Fixture first. persist only runs after --write has succeeded.
    if (args.write) {
      await writePromotedEvalFile(
        args.write,
        generateEvalModuleSource(loaded.promotion.eval),
      );
    }
    result = loaded.alreadyStored
      ? loaded.promotion
      : {
          ...loaded.promotion,
          dataset: await persistPromotedEvalDataset(loaded.promotion.dataset),
        };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (args.json) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.error(`\n  eval promote failed: ${message}\n`);
    }
    process.exit(1);
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          sourceRunId: result.sourceRunId,
          dataset: result.dataset,
          eval: result.eval,
          ...(args.write ? { written: args.write } : {}),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `\n  Promoted ${result.sourceRunId} → dataset ${result.dataset.id}` +
        (args.write ? `\n  Wrote ${args.write}` : "") +
        `\n  agent-native eval promote ${result.sourceRunId} --write evals/from-trace.eval.ts\n`,
    );
  }
  process.exit(0);
}

export async function runEval(argv: string[]): Promise<void> {
  const parsed = parseEvalArgs(argv);
  if (parsed.command === "promote") {
    await runPromote(parsed);
    return;
  }

  const { pattern, json, threshold } = parsed;

  // Lazy import: the runner pulls in server-only deps (engine registry, action
  // discovery) we don't want to load for `--help`.
  const { runEvalSuite, formatReport } = await import("../eval/index.js");

  let result: Awaited<ReturnType<typeof runEvalSuite>>;
  try {
    result = await runEvalSuite({
      cwd: process.cwd(),
      pattern,
      thresholdOverride: threshold,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (json) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.error(`\n  eval failed: ${message}\n`);
    }
    process.exit(1);
  }

  const { report, files } = result;

  if (report.total === 0) {
    const hint =
      files.length === 0
        ? "No eval files found (looked for **/*.eval.ts and evals/*.ts)."
        : `Found ${files.length} eval file(s) but no defineEval() exports.`;
    if (json) {
      console.log(JSON.stringify({ ok: true, report, files }, null, 2));
    } else {
      console.log(`\n  ${hint}\n`);
    }
    // Nothing to gate on — exit clean so an app without evals doesn't fail CI.
    process.exit(0);
  }

  if (json) {
    console.log(
      JSON.stringify({ ok: report.failed === 0, report, files }, null, 2),
    );
  } else {
    console.log(formatReport(report));
  }

  // The CI deploy gate: any eval below threshold => non-zero exit.
  process.exit(report.failed > 0 ? 1 : 0);
}
