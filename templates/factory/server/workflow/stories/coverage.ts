import { OPERATION_CATALOG } from "../catalog/index.js";
import { END_OUTCOMES, NODE_KINDS } from "../contract.js";
import type { StoryKey } from "../story-graphs.fixture.js";
import type { ScenarioRun } from "../testing/story-data.js";
import { STORIES } from "./registry.js";

// What the ten stories, run through the real engine, actually exercise. The
// contract the coverage spec enforces: every node kind, End outcome, Wait kind
// and port, loop, source type, AI mode, Builder operation and catalog
// operation is used by at least one story, except what is named in
// `UNUSED_ON_PURPOSE`. Add an operation to the catalog and this fails until a
// story uses it.

/**
 * Catalog operations no story uses, each with the reason. Empty today: all
 * thirty-six are used. An entry here is a decision a reviewer should see, and
 * the spec fails when an operation listed here turns out to be covered.
 */
export const UNUSED_ON_PURPOSE: Readonly<Record<string, string>> = {};

/**
 * What no story can prove yet because the engine lacks the feature, each with
 * the check it needs. A follow-up, not a decision: delete the entry when the
 * feature lands.
 */
export const FOLLOW_UPS: Readonly<Record<string, string>> = {
  "A model's answer checked against a lookup result":
    "Story 6 sends a billing answer on the model's own `supported` and `confidence` flags, which came out `supported: true, confidence: high` in nine of nine real-model runs, so any digit in the answer sends it to finance instead. Sending an amount or a date safely needs a check that every one in the answer appears in the Stripe lookup result (cents read as dollars), which no node kind or rule does today.",
};

export type StoryRuns = Record<StoryKey, Record<string, ScenarioRun>>;

export const WAIT_KINDS = ["reply", "time", "condition"] as const;
export const WAIT_PORTS = [
  "reply:replied",
  "reply:timedOut",
  "time:done",
  "condition:met",
  "condition:timedOut",
] as const;
export const SOURCE_TYPES = [
  "inbox-poll",
  "provider-query",
  "window",
  "status",
] as const;
export const AI_USES = [
  "perItem",
  "wholeList",
  "aiWrittenField",
  "readOnlyTools",
] as const;
export const BUILDER_OPS = [
  "builder.start",
  "builder.check",
  "builder.followUp",
] as const;
export const PATHS = [
  "dryRun",
  "testStep",
  "runFailed",
  "itemFailed",
  "needsCheck",
  "lookupFailed",
  "aiInvalidOutput",
  "crashRecovery",
  "restart",
  "parkedThenWoken",
] as const;

/** The families the table reports, each a list of the things in it. */
export interface CoverageSpec {
  nodeKinds: readonly string[];
  operations: readonly string[];
  endOutcomes: readonly string[];
  waitKinds: readonly string[];
  waitPorts: readonly string[];
  loops: readonly string[];
  sourceTypes: readonly string[];
  aiUses: readonly string[];
  builderOps: readonly string[];
  paths: readonly string[];
}

export const REQUIRED: CoverageSpec = {
  nodeKinds: NODE_KINDS,
  operations: OPERATION_CATALOG.list().map((def) => def.id),
  endOutcomes: END_OUTCOMES,
  waitKinds: WAIT_KINDS,
  waitPorts: WAIT_PORTS,
  loops: ["loopBack", "loopLimitReached"],
  sourceTypes: SOURCE_TYPES,
  aiUses: AI_USES,
  builderOps: BUILDER_OPS,
  paths: PATHS,
};

/** For each thing in each family, the stories whose scenarios exercise it. */
export type CoverageTable = Record<
  keyof CoverageSpec,
  Record<string, StoryKey[]>
>;

function emptyTable(): CoverageTable {
  const table = {} as CoverageTable;
  for (const [family, names] of Object.entries(REQUIRED)) {
    table[family as keyof CoverageSpec] = Object.fromEntries(
      names.map((name: string) => [name, [] as StoryKey[]]),
    );
  }
  return table;
}

export function computeCoverage(runs: StoryRuns): CoverageTable {
  const table = emptyTable();
  const mark = (
    family: keyof CoverageSpec,
    name: string,
    story: StoryKey,
  ): void => {
    const stories = table[family][name];
    if (stories === undefined) {
      throw new Error(
        `Coverage met "${name}", which is not in the ${family} list: add it to REQUIRED.`,
      );
    }
    if (!stories.includes(story)) stories.push(story);
  };

  for (const story of Object.values(STORIES)) {
    const kindOf = new Map(
      story.graph.nodes.map((node) => [node.id, node] as const),
    );
    const scenarios = Object.values(runs[story.key] ?? {});
    for (const { run } of scenarios) {
      const mode = (tick: (typeof run.ticks)[number]) =>
        tick.result?.kind === "ran" ? tick.result.run.mode : undefined;
      let wokenAfterParking = false;
      for (const tick of run.ticks) {
        const ran = tick.result?.kind === "ran" ? tick.result : undefined;
        if (mode(tick) === "dry") mark("paths", "dryRun", story.key);
        if (mode(tick) === "test") mark("paths", "testStep", story.key);
        if (ran?.run.status === "failed") mark("paths", "runFailed", story.key);
        if (tick.crash !== undefined) mark("paths", "crashRecovery", story.key);
        if (ran?.run.counts.sentBack) mark("loops", "loopBack", story.key);
        if (ran?.run.counts.loopLimited) {
          mark("loops", "loopLimitReached", story.key);
        }
        if (ran?.run.counts.woke) wokenAfterParking = true;

        for (const step of tick.steps) {
          const node = kindOf.get(step.nodeId);
          if (!node) continue;
          const received =
            typeof step.fields?.in === "number" ? step.fields.in : 0;
          const sent = Object.values(step.ports).reduce(
            (total, port) => total + port.count,
            0,
          );
          // A Trigger is handed nothing and hands on nothing; it is exercised by the tick that ran it.
          const worked =
            received > 0 ||
            sent > 0 ||
            (node.kind === "trigger" &&
              ran !== undefined &&
              mode(tick) === "live");
          if (worked) {
            mark("nodeKinds", node.kind, story.key);
            if (node.kind === "source" && (step.ports.out?.count ?? 0) > 0) {
              mark("sourceTypes", node.settings.source, story.key);
            }
          }
          if (step.status === "needs_check") {
            mark("paths", "needsCheck", story.key);
          }
          if (step.status === "failed" && step.error !== undefined) {
            if (ran?.run.status !== "failed") {
              mark("paths", "itemFailed", story.key);
            }
            if (step.error.code === "lookup_failed") {
              mark("paths", "lookupFailed", story.key);
            }
            if (step.error.code === "ai_invalid_output") {
              mark("paths", "aiInvalidOutput", story.key);
            }
          }
        }
        for (const call of tick.calls) {
          mark("operations", call.operation.id, story.key);
          if ((BUILDER_OPS as readonly string[]).includes(call.operation.id)) {
            mark("builderOps", call.operation.id, story.key);
          }
        }
        for (const request of tick.aiRequests) {
          mark("aiUses", request.mode, story.key);
          for (const tool of request.tools) {
            mark("operations", tool, story.key);
            mark("aiUses", "readOnlyTools", story.key);
          }
          if (
            !story.graph.nodes.some(
              (node) =>
                node.kind === "ai" &&
                node.settings.instruction === request.instruction,
            )
          ) {
            mark("aiUses", "aiWrittenField", story.key);
          }
        }
      }

      for (const events of Object.values(run.events)) {
        for (const event of events) {
          const node = event.nodeId ? kindOf.get(event.nodeId) : undefined;
          if (event.kind === "ended" && event.outcome !== undefined) {
            mark("endOutcomes", event.outcome, story.key);
          }
          if (node?.kind === "wait" && event.kind === "woke") {
            const wait = node.settings.wait;
            mark("waitKinds", wait, story.key);
            mark("waitPorts", `${wait}:${event.port}`, story.key);
          }
        }
      }
      if (wokenAfterParking) mark("paths", "parkedThenWoken", story.key);
    }
  }

  // A restart step is data, not an event: read it off the script.
  for (const story of Object.values(STORIES)) {
    for (const scenario of Object.values(story.script.scenarios)) {
      if (scenario.steps.some((step) => step.kind === "restart")) {
        mark("paths", "restart", story.key);
      }
    }
  }
  return table;
}

/** What the table lacks: every thing in a family no story exercises, less what is on purpose. */
export function uncovered(
  table: CoverageTable,
): { family: keyof CoverageSpec; name: string }[] {
  const missing: { family: keyof CoverageSpec; name: string }[] = [];
  for (const [family, entries] of Object.entries(table)) {
    for (const [name, stories] of Object.entries(entries)) {
      if (stories.length > 0) continue;
      if (family === "operations" && name in UNUSED_ON_PURPOSE) continue;
      missing.push({ family: family as keyof CoverageSpec, name });
    }
  }
  return missing;
}

const TITLES: Record<keyof CoverageSpec, string> = {
  nodeKinds: "Node kinds",
  sourceTypes: "Source types",
  waitKinds: "Wait kinds",
  waitPorts: "Wait ports that fired",
  endOutcomes: "End outcomes",
  loops: "Loops",
  aiUses: "AI node uses",
  builderOps: "Builder operations",
  paths: "Run paths",
  operations: "Catalog operations",
};

const ORDER: (keyof CoverageSpec)[] = [
  "nodeKinds",
  "sourceTypes",
  "waitKinds",
  "waitPorts",
  "endOutcomes",
  "loops",
  "aiUses",
  "builderOps",
  "paths",
  "operations",
];

const STORY_KEYS = Object.keys(STORIES) as StoryKey[];

/** The coverage table as Markdown. The spec compares this to `COVERAGE.md`, so it cannot drift. */
/** A GFM table with its columns padded, the way the repo's formatter writes one, so formatting the file changes nothing. */
function renderTable(rows: string[][]): string[] {
  const widths = rows[0].map((_, column) =>
    Math.max(3, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]) =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column])).join(" | ")} |`;
  return [
    line(rows[0]),
    `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
    ...rows.slice(1).map(line),
  ];
}

/** The coverage table as Markdown. The spec compares this to `COVERAGE.md`, so it cannot drift. */
export function renderCoverage(table: CoverageTable): string {
  const lines = [
    "# Story coverage",
    "",
    "What the ten stories exercise when their scripts run through the real engine. Generated by `pnpm stories:update`; the coverage spec fails when this file is out of date, or when a node kind, End outcome, Wait kind, loop, source type, AI use, Builder operation or catalog operation has no story.",
    "",
    "A dot means the story's scenarios reach it: a node kind or source type moved items, an operation was called (or, for the read-only repository tools of an AI node, offered to the model), a Wait woke an item, an End finished one.",
    "",
    `Stories: ${STORY_KEYS.map((key, index) => `${index + 1} ${key}`).join(", ")}.`,
    "",
  ];
  for (const family of ORDER) {
    const rows = [
      ["Capability", ...STORY_KEYS.map((_, index) => String(index + 1))],
      ...Object.entries(table[family]).map(([name, stories]) => {
        const unused =
          family === "operations" ? UNUSED_ON_PURPOSE[name] : undefined;
        return [
          `\`${name}\`${unused === undefined ? "" : ` (unused on purpose: ${unused})`}`,
          ...STORY_KEYS.map((key) => (stories.includes(key) ? "●" : "")),
        ];
      }),
    ];
    lines.push(`## ${TITLES[family]}`, "", ...renderTable(rows), "");
  }
  const reasons = Object.entries(UNUSED_ON_PURPOSE);
  lines.push(
    "## Unused on purpose",
    "",
    reasons.length === 0
      ? "None: every catalog operation is used by a story."
      : reasons.map(([name, why]) => `- \`${name}\`: ${why}`).join("\n"),
    "",
    "## Follow-ups",
    "",
    Object.entries(FOLLOW_UPS)
      .map(([name, why]) => `- ${name}: ${why}`)
      .join("\n"),
    "",
  );
  return lines.join("\n");
}
