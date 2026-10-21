import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { OPERATION_CATALOG } from "../catalog/index.js";
import { validateWorkflowGraph } from "../graph-validation.js";
import {
  REQUIRED,
  UNUSED_ON_PURPOSE,
  computeCoverage,
  renderCoverage,
  uncovered,
} from "./coverage.js";
import { runAllStories, scenarioRun } from "./proof-kit.js";
import { STORIES } from "./registry.js";

const stories = Object.values(STORIES);
const folderOf = (folder: string) => path.join(import.meta.dirname, folder);

describe("the story folders", () => {
  it("are the ten stories, numbered in order, one folder each", () => {
    expect(stories.map((story) => story.folder)).toEqual(
      stories.map(
        (story, index) => `${String(index + 1).padStart(2, "0")}-${story.key}`,
      ),
    );
    expect(stories).toHaveLength(10);
  });

  it.each(stories)("$folder holds every file a story is made of", (story) => {
    for (const file of [
      "story.md",
      "workflow.json",
      "script.json",
      "expect.json",
      "fixtures/provider.json",
      "fixtures/ai.json",
      "fixtures/inbox.json",
    ]) {
      expect(existsSync(path.join(folderOf(story.folder), file)), file).toBe(
        true,
      );
    }
  });

  it.each(stories)(
    "$folder starts its story with the prompt a user would type",
    (story) => {
      const text = readFileSync(
        path.join(folderOf(story.folder), "story.md"),
        "utf8",
      );
      const [title, ...rest] = text
        .split("\n")
        .filter((line) => line.trim() !== "");
      expect(title).toMatch(/^# Story \d+\./);
      expect(rest[0]).toMatch(/^\*\*Prompt\.\*\* ".+"$/);
    },
  );
});

describe.each(stories)("story $folder", (story) => {
  const scenarios = Object.entries(story.script.scenarios);

  it("validates against the real catalog with no issues", () => {
    expect(validateWorkflowGraph(story.graph, OPERATION_CATALOG)).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("has a script and an expectation for the same scenarios, at least one", () => {
    expect(scenarios.length).toBeGreaterThan(0);
    expect(Object.keys(story.expect)).toEqual(
      Object.keys(story.script.scenarios),
    );
  });

  it.each(scenarios)(
    "scenario %s comes to what expect.json says",
    async (name) => {
      const { summary } = await scenarioRun(story.key, name);
      expect(summary).toEqual(story.expect[name]);
    },
  );

  it("reaches every node of its graph in some scenario", async () => {
    const reached = new Set<string>();
    for (const [name] of scenarios) {
      const { run } = await scenarioRun(story.key, name);
      for (const tick of run.ticks) {
        const ran = tick.result?.kind === "ran";
        for (const step of tick.steps) {
          const received =
            typeof step.fields?.in === "number" ? step.fields.in : 0;
          const sent = Object.values(step.ports).some((port) => port.count > 0);
          if (received > 0 || sent) reached.add(step.nodeId);
        }
        if (ran) {
          for (const node of story.graph.nodes) {
            if (node.kind === "trigger") reached.add(node.id);
          }
        }
      }
    }
    expect(
      story.graph.nodes.map((node) => node.id).filter((id) => !reached.has(id)),
    ).toEqual([]);
  });
});

describe("the coverage matrix", () => {
  it("has a story for every node kind, End outcome, Wait kind, loop, source type, AI use, Builder operation and catalog operation", async () => {
    const table = computeCoverage(await runAllStories());
    expect(
      uncovered(table),
      "Use each of these in a story, or list the operation in UNUSED_ON_PURPOSE with a reason",
    ).toEqual([]);
  });

  it("fails loudly when the catalog gains an operation no story uses", () => {
    const catalogIds = OPERATION_CATALOG.list().map((def) => def.id);
    expect([...REQUIRED.operations].sort()).toEqual([...catalogIds].sort());
  });

  it("lists only operations that exist and are not covered, each with a reason", async () => {
    const table = computeCoverage(await runAllStories());
    for (const [operation, reason] of Object.entries(UNUSED_ON_PURPOSE)) {
      expect(OPERATION_CATALOG.get(operation), operation).toBeDefined();
      expect(reason.trim(), operation).not.toBe("");
      expect(
        table.operations[operation],
        `${operation} is covered after all`,
      ).toEqual([]);
    }
  });

  it("is rendered in COVERAGE.md exactly as it stands", async () => {
    const table = computeCoverage(await runAllStories());
    const written = readFileSync(
      path.join(import.meta.dirname, "COVERAGE.md"),
      "utf8",
    );
    expect(written).toBe(renderCoverage(table));
  });
});
