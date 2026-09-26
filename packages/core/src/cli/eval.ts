import process from "node:process";

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
    process.exit(0);
  }

  if (json) {
    console.log(
      JSON.stringify({ ok: report.failed === 0, report, files }, null, 2),
    );
  } else {
    console.log(formatReport(report));
  }

  process.exit(report.failed > 0 ? 1 : 0);
}
