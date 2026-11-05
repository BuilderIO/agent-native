import { beforeAll, describe, expect, it } from "vitest";

import type { ActionEntry } from "./production-agent.js";
import { TOOL_SEARCH_BENCHMARK_CASES } from "./tool-search-benchmark-cases.harness.js";
import {
  formatReport,
  loadTemplateRegistry,
  runCase,
  summarize,
  type CaseResult,
} from "./tool-search-benchmark.harness.js";

// Ratchets: raise these when ranking improves, never lower them. A change that
// drops a score below its floor made tool-search worse at finding real tools.
// Before BM25F, hints and the vocabulary changes: R@5 0.727 (held out 0.882),
// MRR 0.546.
const MIN_RECALL_AT_5 = { all: 0.96, heldOut: 0.88 };
const MIN_MRR = 0.87;

const LOAD_TIMEOUT_MS = 180_000;

const templates = [
  ...new Set(TOOL_SEARCH_BENCHMARK_CASES.map((c) => c.template)),
];

describe("tool-search retrieval benchmark", () => {
  const registries = new Map<string, Record<string, ActionEntry>>();
  let results: CaseResult[] = [];

  beforeAll(async () => {
    for (const template of templates) {
      registries.set(template, await loadTemplateRegistry(template));
    }
    results = TOOL_SEARCH_BENCHMARK_CASES.map((benchmarkCase) =>
      runCase(registries.get(benchmarkCase.template)!, benchmarkCase),
    );
    const rows = [
      { label: "all", metrics: summarize(results) },
      {
        label: "tuning",
        metrics: summarize(results.filter((r) => !r.benchmarkCase.heldOut)),
      },
      {
        label: "held out",
        metrics: summarize(results.filter((r) => r.benchmarkCase.heldOut)),
      },
      ...templates.map((template) => ({
        label: template,
        metrics: summarize(
          results.filter((r) => r.benchmarkCase.template === template),
        ),
      })),
    ];
    process.stdout.write(
      `${formatReport(
        rows,
        results.filter((r) => r.recallAt5 < 1),
      )}\n`,
    );
  }, LOAD_TIMEOUT_MS);

  it("covers at least 40 requests, about a quarter of them held out", () => {
    const heldOut = TOOL_SEARCH_BENCHMARK_CASES.filter((c) => c.heldOut);
    expect(TOOL_SEARCH_BENCHMARK_CASES.length).toBeGreaterThanOrEqual(40);
    expect(heldOut.length / TOOL_SEARCH_BENCHMARK_CASES.length).toBeGreaterThan(
      0.2,
    );
  });

  it("finds the right tools in the top 5 across every request", () => {
    expect(summarize(results).recallAt5).toBeGreaterThanOrEqual(
      MIN_RECALL_AT_5.all,
    );
  });

  it("ranks the right tool near the top across every request", () => {
    expect(summarize(results).mrr).toBeGreaterThanOrEqual(MIN_MRR);
  });

  it("finds the right tools in the top 5 for held-out requests", () => {
    expect(
      summarize(results.filter((r) => r.benchmarkCase.heldOut)).recallAt5,
    ).toBeGreaterThanOrEqual(MIN_RECALL_AT_5.heldOut);
  });
});
