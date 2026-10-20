import { describe, expect, it } from "vitest";

import { WORKFLOW_CATALOG } from "@/components/workflow/workflow-catalog";
import type { WorkflowGraph, WorkflowNode } from "@/lib/workflow-editor";

import { buildFormContext, type PathSuggestion } from "./context";

const at = { x: 0, y: 0 };

const leads: WorkflowNode = {
  id: "leads",
  name: "leads",
  kind: "source",
  position: at,
  settings: {
    source: "provider-query",
    operation: "hubspot.newLeads",
    args: {},
    memory: "none",
    maxItems: 50,
  },
};
const classify: WorkflowNode = {
  id: "classify",
  name: "classify",
  kind: "ai",
  position: at,
  settings: {
    instruction: "Rank the lead",
    result: {
      priority: { type: "enum", enum: ["low", "high"] },
      summary: { type: "string" },
    },
    mode: "perItem",
    tools: [],
    batchSize: 10,
  },
};
const notify: WorkflowNode = {
  id: "notify",
  name: "notify",
  kind: "action",
  position: at,
  settings: { operation: "slack.postMessage", args: {} },
};
const digest: WorkflowNode = {
  id: "digest",
  name: "digest",
  kind: "ai",
  position: at,
  settings: {
    instruction: "Summarize the day",
    result: { headline: { type: "string" } },
    mode: "wholeList",
    tools: [],
    batchSize: 10,
  },
};

// leads -> classify -> notify -> digest: `digest` runs after `notify`, so
// `notify` cannot read it.
const graph: WorkflowGraph = {
  nodes: [leads, classify, notify, digest],
  edges: [
    { id: "a", from: { node: "leads", port: "out" }, to: { node: "classify" } },
    {
      id: "b",
      from: { node: "classify", port: "out" },
      to: { node: "notify" },
    },
    { id: "c", from: { node: "notify", port: "out" }, to: { node: "digest" } },
  ],
  settings: { checkCadenceMinutes: 15, modelCallCap: 50 },
};

function suggestionsFor(nodeId: string): PathSuggestion[] {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`the fixture has no node ${nodeId}`);
  return buildFormContext(graph, node, WORKFLOW_CATALOG).suggestions;
}

const paths = (suggestions: PathSuggestion[], group: PathSuggestion["group"]) =>
  suggestions
    .filter((entry) => entry.group === group)
    .map((entry) => entry.path);

describe("field suggestions for a step", () => {
  it("offers the result keys of the steps above, and not of the steps below", () => {
    const suggestions = suggestionsFor("notify");
    expect(paths(suggestions, "aiResult")).toEqual([
      "nodes.classify.priority",
      "nodes.classify.summary",
    ]);
    expect(suggestions.map((entry) => entry.path)).not.toContain(
      "nodes.digest.headline",
    );
  });

  it("offers no result keys when no AI step is above the selected step", () => {
    expect(paths(suggestionsFor("leads"), "aiResult")).toEqual([]);
  });

  it("offers the extras a provider query above the step declares, as item fields", () => {
    const suggestions = suggestionsFor("notify");
    expect(paths(suggestions, "itemField")).toEqual(
      expect.arrayContaining(["item.extras.ownerId", "item.extras.company"]),
    );
  });

  it("offers no declared extras from a step that is not above the selected one", () => {
    expect(suggestionsFor("leads").map((entry) => entry.path)).not.toContain(
      "item.extras.ownerId",
    );
  });

  it("keeps the fields every item carries, in the item-field group", () => {
    const suggestions = suggestionsFor("classify");
    for (const path of [
      "item.title",
      "item.text",
      "item.url",
      "item.author",
      "item.occurredAt",
    ]) {
      expect(suggestions).toContainEqual({ path, group: "itemField" });
    }
  });
});
