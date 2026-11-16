import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isActionHiddenFromEveryAgentSurface } from "../action.js";
import { loadActionsStrictly } from "../mcp/advertised-catalog.harness.js";
import { mergeCoreSharingActions } from "../server/action-discovery.js";
import { generateActionRegistryForProject } from "../vite/action-types-plugin.js";
import type { ActionEntry } from "./production-agent.js";
import {
  attachToolSearch,
  filterActionsForAgentDiscovery,
  searchToolRegistry,
} from "./tool-search.js";

const templatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../templates",
);

export interface BenchmarkCase {
  template: string;
  /** What the user typed, passed to `tool-search` unchanged. */
  prompt: string;
  /**
   * Each inner list is one tool the task needs; any name in it satisfies it.
   * A multi-step task lists several.
   */
  expected: string[][];
  /** Written before ranking was tuned and never used to tune it. */
  heldOut?: boolean;
}

export interface CaseResult {
  benchmarkCase: BenchmarkCase;
  ranked: string[];
  /** 1-based rank of the first tool that satisfies any expected need. */
  firstRelevantRank: number | null;
  /** Fraction of expected needs satisfied within the top 5. */
  recallAt5: number;
}

export interface Metrics {
  cases: number;
  recallAt1: number;
  recallAt5: number;
  mrr: number;
}

/**
 * The template's own actions plus the framework actions every app registers,
 * loaded the way the app loads them and filtered the way a chat request
 * filters them, so the benchmark ranks only what the agent can actually see.
 */
export async function loadTemplateRegistry(
  template: string,
): Promise<Record<string, ActionEntry>> {
  const projectRoot = path.join(templatesRoot, template);
  generateActionRegistryForProject(projectRoot);
  const registryUrl = pathToFileURL(
    path.join(projectRoot, ".generated/actions-registry.ts"),
  ).href;
  const { default: modules } = await import(/* @vite-ignore */ registryUrl);
  const registry = loadActionsStrictly(template, modules);
  await mergeCoreSharingActions(registry);
  return filterActionsForAgentDiscovery(attachToolSearch(registry), {
    caller: "tool",
    appId: template,
  });
}

export function runCase(
  registry: Record<string, ActionEntry>,
  benchmarkCase: BenchmarkCase,
): CaseResult {
  const missing = benchmarkCase.expected.flat().filter((name) => {
    const entry = Object.hasOwn(registry, name) ? registry[name] : undefined;
    return !entry || isActionHiddenFromEveryAgentSurface(entry);
  });
  if (missing.length > 0) {
    throw new Error(
      `templates/${benchmarkCase.template}: expected tools are not visible to the agent: ${missing.join(", ")} (prompt: "${benchmarkCase.prompt}")`,
    );
  }
  const ranked = searchToolRegistry(
    registry,
    { query: benchmarkCase.prompt, limit: 10 },
    { defaultLimit: 10, maxLimit: 10 },
  ).results.map((result) => result.name);
  const relevant = new Set(benchmarkCase.expected.flat());
  const index = ranked.findIndex((name) => relevant.has(name));
  const top5 = new Set(ranked.slice(0, 5));
  const satisfied = benchmarkCase.expected.filter((need) =>
    need.some((name) => top5.has(name)),
  ).length;
  return {
    benchmarkCase,
    ranked,
    firstRelevantRank: index < 0 ? null : index + 1,
    recallAt5: satisfied / benchmarkCase.expected.length,
  };
}

export function summarize(results: readonly CaseResult[]): Metrics {
  const n = results.length;
  if (n === 0) throw new Error("No benchmark cases to summarize.");
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    cases: n,
    recallAt1: round(
      results.filter((result) => result.firstRelevantRank === 1).length / n,
    ),
    recallAt5: round(
      results.reduce((sum, result) => sum + result.recallAt5, 0) / n,
    ),
    mrr: round(
      results.reduce(
        (sum, result) =>
          sum + (result.firstRelevantRank ? 1 / result.firstRelevantRank : 0),
        0,
      ) / n,
    ),
  };
}

export function formatReport(
  rows: ReadonlyArray<{ label: string; metrics: Metrics }>,
  misses: readonly CaseResult[],
): string {
  const lines = [
    "tool-search retrieval benchmark",
    "split                     cases  R@1    R@5    MRR",
    ...rows.map(
      ({ label, metrics }) =>
        `${label.padEnd(25)} ${String(metrics.cases).padStart(5)}  ${metrics.recallAt1.toFixed(3)}  ${metrics.recallAt5.toFixed(3)}  ${metrics.mrr.toFixed(3)}`,
    ),
  ];
  if (misses.length > 0) {
    lines.push("", "Cases with an expected tool outside the top 5:");
    for (const miss of misses) {
      lines.push(
        `  [${miss.benchmarkCase.template}${miss.benchmarkCase.heldOut ? ", held out" : ""}] "${miss.benchmarkCase.prompt}" -> top 5: ${miss.ranked.slice(0, 5).join(", ") || "(none)"}`,
      );
    }
  }
  return lines.join("\n");
}
