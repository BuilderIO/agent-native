import { describe, expect, it } from "vitest";

import { OPERATION_CATALOG } from "../../../server/workflow/catalog/index.js";
import {
  STORY_GRAPHS,
  type StoryKey,
} from "../../../server/workflow/story-graphs.fixture.js";
import { createWorkflowEditor } from "./editor.js";
import { workflowGraphSchema, type WorkflowGraph } from "./engine.js";
import { layoutGraph } from "./layout.js";
import { nodeSize } from "./node-metrics.js";

const catalog = OPERATION_CATALOG;
const stories = Object.entries(STORY_GRAPHS) as [StoryKey, WorkflowGraph][];

function overlap(graph: WorkflowGraph) {
  const rects = graph.nodes.map((node) => ({
    id: node.id,
    ...node.position,
    ...nodeSize(graph, node),
  }));
  const hits: string[] = [];
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      if (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
      ) {
        hits.push(`${a.id}/${b.id}`);
      }
    }
  }
  return hits;
}

describe("the ten story graphs through the editor", () => {
  it.each(stories)("%s loads and validates clean", (_key, graph) => {
    const editor = createWorkflowEditor({ graph, catalog });
    expect(editor.getSnapshot().graph).toBe(graph);
    expect(editor.validate()).toMatchObject({ ok: true, issues: [] });
  });

  it.each(stories)(
    "%s lays out left to right with no overlap",
    (_key, graph) => {
      const editor = createWorkflowEditor({ graph, catalog });
      expect(editor.autoLayout().ok).toBe(true);
      const laid = editor.getSnapshot().graph;
      const at = new Map(laid.nodes.map((node) => [node.id, node.position]));
      for (const edge of laid.edges) {
        if (edge.back) continue;
        expect(at.get(edge.to.node)!.x).toBeGreaterThan(
          at.get(edge.from.node)!.x,
        );
      }
      expect(overlap(laid)).toEqual([]);
      for (const { x, y } of at.values()) {
        expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
      }
      expect(workflowGraphSchema.safeParse(laid).success).toBe(true);
      expect(editor.validate()).toMatchObject({ ok: true, issues: [] });
    },
  );

  it.each(stories)("%s undoes a layout back to the original", (_key, graph) => {
    const editor = createWorkflowEditor({ graph, catalog });
    editor.autoLayout();
    editor.undo();
    expect(editor.getSnapshot().graph).toBe(graph);
  });

  it.each(stories)(
    "%s survives delete and undo, duplicate and undo",
    (_key, graph) => {
      const editor = createWorkflowEditor({ graph, catalog });
      const middle = graph.nodes.find((node) => node.kind !== "trigger")!;
      editor.deleteElements({ nodeIds: [middle.id] });
      editor.undo();
      expect(editor.getSnapshot().graph).toBe(graph);
      editor.duplicateNodes([middle.id]);
      expect(
        workflowGraphSchema.safeParse(editor.getSnapshot().graph).success,
      ).toBe(true);
      editor.undo();
      expect(editor.getSnapshot().graph).toBe(graph);
    },
  );

  it("keeps a loop's back-edge from reordering the nodes it spans", () => {
    const graph = STORY_GRAPHS["bug-report-to-builder"];
    const positions = layoutGraph(graph);
    const back = graph.edges.find((edge) => edge.back)!;
    expect(positions[back.to.node].x).toBeLessThan(positions[back.from.node].x);
    for (const edge of graph.edges) {
      if (edge.back) continue;
      expect(positions[edge.to.node].x).toBeGreaterThan(
        positions[edge.from.node].x,
      );
    }
  });

  it("keeps the top-left corner the graph already had", () => {
    const graph = STORY_GRAPHS["morning-digest"];
    const shifted: WorkflowGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        position: { x: node.position.x + 500, y: node.position.y + 300 },
      })),
    };
    const positions = Object.values(layoutGraph(shifted));
    expect(Math.min(...positions.map((p) => p.x))).toBe(
      Math.min(...shifted.nodes.map((n) => n.position.x)),
    );
    expect(Math.min(...positions.map((p) => p.y))).toBe(
      Math.min(...shifted.nodes.map((n) => n.position.y)),
    );
  });

  it("lays out the same graph the same way twice", () => {
    const graph = STORY_GRAPHS["builder-to-merge"];
    expect(layoutGraph(graph)).toEqual(layoutGraph(graph));
  });
});

describe("rename references match what the validator would flag", () => {
  it.each(stories)("%s", (_key, graph) => {
    for (const node of graph.nodes) {
      const editor = createWorkflowEditor({ graph, catalog });
      const result = editor.renameNode(node.id, `${node.name}Renamed`);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const flagged = new Set(
        editor
          .validate()
          .issues.filter((issue) => issue.code === "bad_reference")
          .map((issue) => issue.nodeId),
      );
      const reported = new Set(result.references.map((ref) => ref.nodeId));
      expect([...reported].sort()).toEqual([...flagged].sort());
    }
  });
});
