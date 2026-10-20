import { describe, expect, it } from "vitest";

import { createEnglishTranslator } from "@/lib/__tests__/en-translator";
import type { WorkflowIssue } from "@/lib/workflow-editor";

import { createWorkflowCanvasStrings } from "../workflow-canvas/strings";
import { minimalWorkflowGraph } from "./new-workflow";
import type { ServerIssue } from "./workflow-errors";
import { listProblems as listProblemsOf } from "./workflow-problems";
import { createWorkflowStrings } from "./workflow-strings";

const t = createEnglishTranslator();
const strings = {
  canvas: createWorkflowCanvasStrings(t),
  workflow: createWorkflowStrings(t),
};
const listProblems = (
  input: Omit<Parameters<typeof listProblemsOf>[0], "strings">,
) => listProblemsOf({ ...input, strings });

const graph = minimalWorkflowGraph();
const trigger = graph.nodes[0]!;
const edge = graph.edges[0]!;

describe("listProblems", () => {
  it("words each editor problem and names the step it is about", () => {
    const rows = listProblems({
      graph,
      issues: [{ code: "port_leads_nowhere", nodeId: trigger.id, port: "out" }],
      serverIssues: [],
    });
    expect(rows).toEqual([
      {
        key: "local:0",
        sentence: "The Next output leads nowhere.",
        nodeId: trigger.id,
        where: trigger.name,
      },
    ]);
  });

  it("describes a problem on a connection by the two steps it joins", () => {
    const [row] = listProblems({
      graph,
      issues: [{ code: "edge_unknown_port", edgeId: edge.id }],
      serverIssues: [],
    });
    expect(row).toMatchObject({
      edgeId: edge.id,
      where: `${trigger.name} → ${graph.nodes[1]!.name}`,
    });
  });

  it("adds what the last refused save found and the editor cannot see", () => {
    const serverIssues: ServerIssue[] = [
      {
        source: "job",
        code: "schedule_timezone_required",
        nodeId: trigger.id,
        detail: "A daily trigger needs a time zone.",
      },
      {
        source: "schema",
        code: "too_small",
        path: "nodes.0.name",
        detail: "Too short",
      },
    ];
    const rows = listProblems({ graph, issues: [], serverIssues });
    expect(rows.map((row) => row.sentence)).toEqual([
      "A daily trigger needs a time zone.",
      "nodes.0.name: Too short",
    ]);
    expect(rows[0]).toMatchObject({ nodeId: trigger.id, where: trigger.name });
    expect(rows[1]).not.toHaveProperty("nodeId");
  });

  it("lists a problem both the editor and the server found once", () => {
    const issue: WorkflowIssue = {
      code: "port_leads_nowhere",
      nodeId: trigger.id,
      port: "out",
    };
    const rows = listProblems({
      graph,
      issues: [issue],
      serverIssues: [{ source: "graph", ...issue }],
    });
    expect(rows).toHaveLength(1);
  });

  it("shows a code the editor has no sentence for as the server worded it", () => {
    const [row] = listProblems({
      graph,
      issues: [],
      serverIssues: [
        { source: "graph", code: "brand_new_rule", detail: "Something new." },
      ],
    });
    expect(row?.sentence).toBe("Something new.");
    const [local] = listProblems({
      graph,
      issues: [{ code: "brand_new_rule" as never, detail: "Detail here" }],
      serverIssues: [],
    });
    expect(local?.sentence).toBe("Detail here");
  });
});
