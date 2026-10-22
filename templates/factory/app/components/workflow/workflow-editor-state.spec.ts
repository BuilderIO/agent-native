import { describe, expect, it } from "vitest";

import type { WorkflowIssue } from "@/lib/workflow-editor";

import { minimalWorkflowGraph } from "./new-workflow";
import {
  buildAgentContext,
  buildEditorAppState,
  isGraphDirty,
  summarizeIssues,
} from "./workflow-editor-state";

const graph = minimalWorkflowGraph();
const triggerId = graph.nodes[0]!.id;

function issues(count: number): WorkflowIssue[] {
  return Array.from({ length: count }, (_, index) => ({
    code: "port_leads_nowhere" as const,
    nodeId: triggerId,
    port: "out",
    detail: `detail ${index}`,
  }));
}

describe("isGraphDirty", () => {
  it("is false for the same graph and for an equal copy", () => {
    expect(isGraphDirty(graph, graph)).toBe(false);
    expect(isGraphDirty(structuredClone(graph), graph)).toBe(false);
  });

  it("is true once a node moves", () => {
    const moved = structuredClone(graph);
    moved.nodes[0]!.position = { x: 999, y: 999 };
    expect(isGraphDirty(moved, graph)).toBe(true);
  });
});

describe("summarizeIssues", () => {
  it("counts them all and lists at most ten, with node names", () => {
    const summary = summarizeIssues(issues(25), graph);
    expect(summary.issueCount).toBe(25);
    expect(summary.issues).toHaveLength(10);
    expect(summary.issues[0]).toMatchObject({
      code: "port_leads_nowhere",
      nodeId: triggerId,
      nodeName: graph.nodes[0]!.name,
      port: "out",
    });
  });

  it("clips a long detail", () => {
    const [issue] = summarizeIssues(
      [{ code: "bad_reference", detail: "x".repeat(500) }],
      graph,
    ).issues;
    expect(issue?.detail?.length).toBeLessThanOrEqual(160);
  });
});

describe("buildEditorAppState", () => {
  it("bounds the issues and the selection", () => {
    const state = buildEditorAppState({
      workflowId: "w1",
      name: "N".repeat(300),
      baseVersion: 4,
      dirty: true,
      saving: false,
      issues: issues(40),
      graph,
      selection: {
        nodeIds: Array.from({ length: 50 }, (_, i) => `n${i}`),
        edgeIds: [],
      },
      runId: "r1",
    });
    expect(state.issueCount).toBe(40);
    expect(state.issues).toHaveLength(10);
    expect(state.selection.nodeIds).toHaveLength(20);
    expect(state.name.length).toBeLessThanOrEqual(120);
    expect(state).toMatchObject({
      workflowId: "w1",
      baseVersion: 4,
      dirty: true,
      saving: false,
      runId: "r1",
    });
  });
});

describe("buildAgentContext", () => {
  const base = {
    factoryId: "f1",
    workflowId: "w1",
    name: "Bug report to Builder",
    version: 12,
    enabled: true,
    dirty: false,
    graph,
  };
  const selection = {
    nodeCount: 2,
    edgeCount: 1,
    selectedNodes: [
      { id: triggerId, name: "trigger", kind: "trigger" as const },
    ],
    selectedEdges: [],
    truncated: false,
  };

  it("names the workflow, the selection and the problems, never the graph", () => {
    const parsed = JSON.parse(
      buildAgentContext({ ...base, selection, issues: issues(2), runId: "r1" }),
    );
    expect(parsed).toMatchObject({
      surface: "factory-workflow-canvas",
      factoryId: "f1",
      workflow: {
        id: "w1",
        name: "Bug report to Builder",
        version: 12,
        enabled: true,
        unsavedChanges: false,
      },
      selection: { selectedNodes: [{ id: triggerId }] },
      issueCount: 2,
      runId: "r1",
    });
    expect(parsed).not.toHaveProperty("graph");
  });

  it("stays under the size cap however much is selected", () => {
    const wide = {
      ...selection,
      selectedNodes: Array.from({ length: 200 }, (_, i) => ({
        id: `node_${i}_${"x".repeat(40)}`,
        name: `name_${i}_${"y".repeat(40)}`,
        kind: "action" as const,
        operation: "slack.postMessage",
      })),
    };
    const json = buildAgentContext({
      ...base,
      selection: wide,
      issues: issues(40),
    });
    expect(json.length).toBeLessThanOrEqual(4000);
    expect(JSON.parse(json)).toMatchObject({
      workflow: { id: "w1" },
      issueCount: 40,
      selection: { truncated: true },
    });
  });
});
