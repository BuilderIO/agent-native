import { performance } from "node:perf_hooks";
import process from "node:process";

import type { EngineTool } from "../packages/core/src/agent/engine/types.js";
import { preloadJevTools } from "../packages/core/src/agent/jev-tool-prefetch.js";
import type { ActionEntry } from "../packages/core/src/agent/production-agent.js";
import { searchToolRegistry } from "../packages/core/src/agent/tool-search.js";

const TOP_K = 3;

type EvalCase = {
  name: string;
  request: string;
  expected: string[];
};

type SelectionScore = {
  top1: boolean;
  topK: boolean;
  reciprocalRank: number;
};

type CaseResult = {
  name: string;
  request: string;
  expected: string[];
  baseline: string[];
  jev: string[];
  baselineMs: number;
  jevMs: number;
  baselineScore: SelectionScore;
  jevScore: SelectionScore;
};

export type JevToolSelectionEvalReport = {
  cases: CaseResult[];
  baseline: Summary;
  jev: Summary;
  jevWins: number;
  jevRegressions: number;
};

type Summary = {
  runs: number;
  top1Accuracy: number;
  topKRecall: number;
  meanReciprocalRank: number;
  medianMs: number;
  p95Ms: number;
  failures: number;
};

const tools = [
  [
    "search-crm-contacts",
    "Search CRM contacts and customer records by name, email, account, or company.",
  ],
  ["create-crm-contact", "Create a new contact in the CRM."],
  ["update-crm-contact", "Update fields on an existing CRM contact."],
  [
    "list-crm-opportunities",
    "List sales opportunities and pipeline deals in the CRM.",
  ],
  [
    "search-email",
    "Search the mailbox for messages by sender, subject, or text.",
  ],
  ["send-email", "Send an email message to one or more recipients."],
  ["draft-email", "Create an email draft without sending it."],
  ["create-calendar-event", "Create a meeting or event on a calendar."],
  [
    "find-calendar-availability",
    "Find open meeting times for people on a calendar.",
  ],
  ["cancel-calendar-event", "Cancel an existing calendar event."],
  ["search-documents", "Search workspace documents, pages, and project notes."],
  ["create-document", "Create a new workspace document or page."],
  ["update-document", "Update an existing workspace document or page."],
  ["upload-file", "Upload a file to the current project or workspace."],
  ["list-files", "List files in a project or workspace."],
  ["search-slack-messages", "Search Slack messages and team conversations."],
  ["send-slack-message", "Send a message to a Slack channel or teammate."],
  ["create-ticket", "Create a bug or support ticket in the issue tracker."],
  [
    "search-tickets",
    "Search bugs, support tickets, and issue tracker records.",
  ],
  [
    "browser-screenshot",
    "Capture and inspect the currently visible browser screen.",
  ],
  ["navigate-browser", "Navigate the browser to a URL or application page."],
  ["get-repo-diff", "Inspect the current repository diff and changed files."],
] as const;

const evalCases: EvalCase[] = [
  {
    name: "find the account point of contact",
    request: "Find the point person at Acme and give me their email address.",
    expected: ["search-crm-contacts"],
  },
  {
    name: "schedule a meeting",
    request:
      "Put a hold on my calendar for a design review next Tuesday afternoon.",
    expected: ["create-calendar-event"],
  },
  {
    name: "search team chatter",
    request: "Look through team chatter for what we decided about the launch.",
    expected: ["search-slack-messages"],
  },
  {
    name: "send a follow-up note",
    request: "Send the customer a short follow-up note about our conversation.",
    expected: ["send-email"],
  },
  {
    name: "find the checkout bug",
    request: "Find the open checkout issue and show me the latest bug report.",
    expected: ["search-tickets"],
  },
  {
    name: "look up the product spec",
    request: "Look up our latest product specification document.",
    expected: ["search-documents"],
  },
  {
    name: "inspect the visible browser",
    request: "What is currently visible in the browser?",
    expected: ["browser-screenshot"],
  },
  {
    name: "check meeting availability",
    request: "Can I meet Sam tomorrow morning, and when is everyone free?",
    expected: ["find-calendar-availability"],
  },
  {
    name: "upload a project file",
    request: "Add this file to the project workspace.",
    expected: ["upload-file"],
  },
  {
    name: "list sales pipeline",
    request: "Show me the deals currently in our sales pipeline.",
    expected: ["list-crm-opportunities"],
  },
];

const registry: Record<string, ActionEntry> = Object.fromEntries(
  tools.map(([name, description]) => [name, action(description)]),
);
const initialTools = [engineTool("tool-search", "Discover available tools.")];
const availableTools = [
  ...initialTools,
  ...tools.map(([name, description]) => engineTool(name, description)),
];

function action(description: string): ActionEntry {
  return {
    tool: {
      description,
      parameters: { type: "object", properties: {} },
    },
    http: false,
    readOnly: true,
    run: async () => "ok",
  };
}

function engineTool(name: string, description: string): EngineTool {
  return {
    name,
    description,
    inputSchema: { type: "object", properties: {} },
  };
}

function scoreSelection(
  selected: string[],
  expected: string[],
): SelectionScore {
  const rank = selected.findIndex((name) => expected.includes(name));
  return {
    top1: rank === 0,
    topK: rank >= 0,
    reciprocalRank: rank >= 0 ? 1 / (rank + 1) : 0,
  };
}

function baselineSelection(request: string): string[] {
  return searchToolRegistry(registry, {
    query: request,
    limit: TOP_K,
  }).results.map((result) => result.name);
}

async function jevSelection(
  request: string,
  apiKey: string,
): Promise<string[]> {
  const result = await preloadJevTools({
    request,
    apiKey,
    registry,
    initialTools,
    availableTools,
    limit: TOP_K,
  });
  return result
    .map((tool) => tool.name)
    .filter((name) => name !== "tool-search")
    .slice(0, TOP_K);
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function summarize(results: CaseResult[], kind: "baseline" | "jev"): Summary {
  const scores = results.map((result) => result[`${kind}Score`]);
  const latencies = results.map((result) => result[`${kind}Ms`]);
  return {
    runs: results.length,
    top1Accuracy: average(scores.map((score) => Number(score.top1))),
    topKRecall: average(scores.map((score) => Number(score.topK))),
    meanReciprocalRank: average(scores.map((score) => score.reciprocalRank)),
    medianMs: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    failures:
      kind === "jev"
        ? results.filter((result) => result.jev.length === 0).length
        : 0,
  };
}

function average(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

export async function runJevToolSelectionEval(options: {
  apiKey: string;
  cases?: EvalCase[];
  repetitions?: number;
}): Promise<JevToolSelectionEvalReport> {
  const cases = options.cases ?? evalCases;
  const repetitions = Math.max(1, Math.floor(options.repetitions ?? 1));
  const results: CaseResult[] = [];

  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const evalCase of cases) {
      const baselineStart = performance.now();
      const baseline = baselineSelection(evalCase.request);
      const baselineMs = performance.now() - baselineStart;

      const jevStart = performance.now();
      const jev = await jevSelection(evalCase.request, options.apiKey);
      const jevMs = performance.now() - jevStart;

      results.push({
        name:
          repetitions > 1
            ? `${evalCase.name} #${repetition + 1}`
            : evalCase.name,
        request: evalCase.request,
        expected: evalCase.expected,
        baseline,
        jev,
        baselineMs,
        jevMs,
        baselineScore: scoreSelection(baseline, evalCase.expected),
        jevScore: scoreSelection(jev, evalCase.expected),
      });
    }
  }

  return {
    cases: results,
    baseline: summarize(results, "baseline"),
    jev: summarize(results, "jev"),
    jevWins: results.filter(
      (result) => result.jevScore.topK && !result.baselineScore.topK,
    ).length,
    jevRegressions: results.filter(
      (result) => result.baselineScore.topK && !result.jevScore.topK,
    ).length,
  };
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function printReport(report: JevToolSelectionEvalReport): void {
  console.log("Jev tool-selection eval");
  console.log(
    `Cases: ${report.cases.length} | Jev top-3 wins: ${report.jevWins} | regressions: ${report.jevRegressions}`,
  );
  console.log("");
  console.log("metric                 baseline       Jev");
  console.log(
    `top-1 accuracy         ${formatPercent(report.baseline.top1Accuracy).padStart(8)}   ${formatPercent(report.jev.top1Accuracy).padStart(8)}`,
  );
  console.log(
    `top-3 recall           ${formatPercent(report.baseline.topKRecall).padStart(8)}   ${formatPercent(report.jev.topKRecall).padStart(8)}`,
  );
  console.log(
    `mean reciprocal rank   ${report.baseline.meanReciprocalRank.toFixed(2).padStart(8)}   ${report.jev.meanReciprocalRank.toFixed(2).padStart(8)}`,
  );
  console.log(
    `median latency         ${report.baseline.medianMs.toFixed(0).padStart(6)} ms   ${report.jev.medianMs.toFixed(0).padStart(6)} ms`,
  );
  console.log(
    `p95 latency            ${report.baseline.p95Ms.toFixed(0).padStart(6)} ms   ${report.jev.p95Ms.toFixed(0).padStart(6)} ms`,
  );
  console.log(
    `provider failures             -   ${report.jev.failures}/${report.jev.runs}`,
  );
  console.log("");
  for (const result of report.cases) {
    const baselineMark = result.baselineScore.topK ? "✓" : "✗";
    const jevMark = result.jevScore.topK ? "✓" : "✗";
    console.log(
      `${result.name}: baseline ${baselineMark} [${result.baseline.join(", ") || "none"}] | Jev ${jevMark} [${result.jev.join(", ") || "none"}]`,
    );
  }
}

function printHelp(): void {
  console.log(`Run a live Jev-vs-tool-search selection benchmark.

Usage:
  JEV_API_KEY=... pnpm eval:jev-tool-selection [--json] [--repetitions N]

The key is read only from JEV_API_KEY and is never printed. Jev calls use the
same preloadJevTools path used by the agent; baseline uses tool-search ranking.
Latency is selection overhead, not full agent completion time.`);
}

function parseRepetitions(value: string | undefined): number {
  const repetitions = Number(value);
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new Error("--repetitions must be a positive integer.");
  }
  return repetitions;
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const repetitionsIndex = process.argv.indexOf("--repetitions");
  const repetitions =
    repetitionsIndex >= 0
      ? parseRepetitions(process.argv[repetitionsIndex + 1])
      : undefined;

  const apiKey = process.env.JEV_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "JEV_API_KEY is required; pass it through the environment.",
    );
  }

  const report = await runJevToolSelectionEval({ apiKey, repetitions });
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
