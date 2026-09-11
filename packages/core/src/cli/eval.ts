/**
 * `agent-native eval [pattern] [--json] [--threshold N]`
 *
 * Discover the app's `*.eval.ts` / `evals/*.ts` files, actually run the agent
 * for each eval input, score the output with the eval's scorers, print a
 * readable scored table, and EXIT NON-ZERO if any eval scores below its
 * threshold. That non-zero exit makes the command a drop-in CI deploy gate:
 *
 *   - run: agent-native eval                 (block deploy on regressions)
 *   - or:  agent-native eval --json          (machine-readable for CI)
 *
 * The runner resolves a provider-agnostic engine/model from the existing
 * registry — no model is hardcoded — so the same suite runs against whatever
 * engine the app is configured for.
 */

import process from "node:process";

/** Parse `[pattern] [--json] [--threshold N]` from the eval argv. */
function parseEvalArgs(argv: string[]): {
  pattern?: string;
  json: boolean;
  threshold?: number;
} {
  let pattern: string | undefined;
  let json = false;
  let threshold: number | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
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

  return { pattern, json, threshold };
}

function printHelp(): void {
  console.log(`agent-native eval — run agent evals as a CI deploy gate

Usage:
  agent-native eval [pattern] [--json] [--threshold N]

Discovers **/*.eval.ts and evals/*.ts under the current app, runs the agent
for each eval input, scores the output with the eval's scorers, and exits
non-zero if any eval scores below its threshold (so it gates CI/deploys).

Arguments:
  pattern            Only run eval files whose path contains this substring.

Options:
  --json             Emit a machine-readable JSON report (for CI).
  --threshold N      Override every eval's pass threshold (0..1).
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

export async function runEval(argv: string[]): Promise<void> {
  const { pattern, json, threshold } = parseEvalArgs(argv);

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
