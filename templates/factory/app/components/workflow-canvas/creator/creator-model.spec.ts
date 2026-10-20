import { describe, expect, it } from "vitest";

import { createEnglishTranslator } from "@/lib/__tests__/en-translator";
import {
  OUT_PORT,
  createWorkflowEditor,
  firstOpenPort,
  workflowGraphSchema,
  type WorkflowCatalog,
  type WorkflowEditor,
} from "@/lib/workflow-editor";

import { OPERATION_CATALOG } from "../../../../server/workflow/catalog/index.js";
import { createWorkflowCanvasStrings } from "../strings";
import {
  creatorGroups,
  highlightedRow,
  insertOnEdge,
  moveHighlight,
  type CreatorBrowse,
  type CreatorRow,
  type CreatorTarget,
} from "./creator-model";

const strings = createWorkflowCanvasStrings(createEnglishTranslator());
const catalog: WorkflowCatalog = OPERATION_CATALOG;

function list(
  target: CreatorTarget,
  overrides: {
    hasTrigger?: boolean;
    browse?: CreatorBrowse;
    describable?: boolean;
  } = {},
) {
  return creatorGroups({
    catalog,
    target,
    hasTrigger: overrides.hasTrigger ?? false,
    browse: overrides.browse ?? { query: "", provider: null },
    describable: overrides.describable ?? true,
    strings,
  });
}

function rowsOf(groups: ReturnType<typeof list>): CreatorRow[] {
  return groups.flatMap((group) => group.rows);
}

function kindsOf(groups: ReturnType<typeof list>): string[] {
  return rowsOf(groups).flatMap((row) =>
    row.type === "entry" ? [row.entry.kind] : [],
  );
}

function ok<T extends { ok: boolean }>(outcome: T): T & { ok: true } {
  if (!outcome.ok) throw new Error(`expected an edit to succeed`);
  return outcome as T & { ok: true };
}

function openPort(editor: WorkflowEditor, nodeId: string): string {
  const port = firstOpenPort(editor.getSnapshot().graph, nodeId);
  if (port === undefined) throw new Error(`no open output on ${nodeId}`);
  return port;
}

/** trigger -> wait -> filter -> end, plus a loop from the filter back to the wait. */
function sample() {
  const editor = createWorkflowEditor({
    graph: workflowGraphSchema.parse({ nodes: [], edges: [], settings: {} }),
    catalog,
  });
  const trigger = ok(editor.addNode("trigger")).node.id;
  const wait = ok(
    editor.addNode("wait", {
      variant: "time",
      after: { node: trigger, port: OUT_PORT },
    }),
  ).node.id;
  const filter = ok(
    editor.addNode("filter", {
      after: { node: wait, port: openPort(editor, wait) },
    }),
  ).node.id;
  ok(
    editor.addNode("end", {
      after: { node: filter, port: openPort(editor, filter) },
    }),
  );
  const loop = ok(
    editor.connect({ node: filter, port: openPort(editor, filter) }, wait, {
      back: "auto",
    }),
  ).edge.id;
  const graph = editor.getSnapshot().graph;
  const between = (from: string, to: string) => {
    const edge = graph.edges.find(
      (candidate) => candidate.from.node === from && candidate.to.node === to,
    );
    if (!edge) throw new Error(`no edge ${from} -> ${to}`);
    return edge.id;
  };
  return {
    graph,
    trigger,
    wait,
    filter,
    loop,
    forward: between(wait, filter),
  };
}

describe("creatorGroups", () => {
  it("lists the sections in order, with a trigger only while there is none", () => {
    const groups = list({ kind: "append" });
    expect(groups.map((group) => group.heading)).toEqual([
      "triggers",
      "actions",
      "flow",
      "ai",
    ]);
    const first = groups[0]?.rows[0];
    expect(first?.type === "entry" && first.entry.kind).toBe("trigger");
    expect(
      kindsOf(list({ kind: "append" }, { hasTrigger: true })),
    ).not.toContain("trigger");
  });

  it("lists providers as rows in actions, and one provider's operations once opened", () => {
    const actions = list({ kind: "append" }).find(
      (group) => group.heading === "actions",
    );
    expect(
      actions?.rows.some(
        (row) => row.type === "provider" && row.provider === "slack",
      ),
    ).toBe(true);

    const slack = list(
      { kind: "append" },
      { browse: { query: "", provider: "slack" } },
    );
    expect(slack).toHaveLength(1);
    expect(slack[0]?.heading).toBeNull();
    const operations = rowsOf(slack).flatMap((row) =>
      row.type === "entry" ? [row.entry.options.operationId] : [],
    );
    expect(operations).toContain("slack.postMessage");
    expect(
      rowsOf(slack).every(
        (row) => row.type === "entry" && row.entry.provider === "slack",
      ),
    ).toBe(true);
  });

  it("keeps starts out of a connection, and an end out of one too", () => {
    const insert = list({ kind: "insert", edgeId: "e" });
    expect(insert.map((group) => group.heading)).not.toContain("triggers");
    const kinds = kindsOf(insert);
    expect(kinds).toContain("filter");
    expect(kinds).not.toContain("end");
    expect(kinds).not.toContain("source");

    const afterPort = kindsOf(
      list({ kind: "append", after: { nodeId: "n", port: OUT_PORT } }),
    );
    expect(afterPort).not.toContain("trigger");
    expect(afterPort).toContain("source");
  });

  it("matches a query across providers and offers the agent when nothing matches", () => {
    const label = catalog.get("slack.postMessage")?.label ?? "";
    const word = label.split(/\s+/)[0] ?? "";
    expect(word.length).toBeGreaterThan(0);
    const found = rowsOf(
      list({ kind: "append" }, { browse: { query: word, provider: null } }),
    ).flatMap((row) =>
      row.type === "entry" ? [row.entry.options.operationId] : [],
    );
    expect(found).toContain("slack.postMessage");

    const nothing = list(
      { kind: "append" },
      { browse: { query: "zzqx", provider: null } },
    );
    expect(nothing).toEqual([
      { heading: null, rows: [{ type: "describe", id: "describe" }] },
    ]);
    expect(
      list(
        { kind: "append" },
        { browse: { query: "zzqx", provider: null }, describable: false },
      ),
    ).toEqual([]);
  });
});

describe("moveHighlight", () => {
  const rows: CreatorRow[] = [
    { type: "provider", id: "provider:slack", provider: "slack" },
    { type: "describe", id: "describe" },
  ];

  it("starts on the first row and moves between rows, stopping at the ends", () => {
    expect(highlightedRow(rows, null)?.id).toBe("provider:slack");
    expect(highlightedRow(rows, "gone")?.id).toBe("provider:slack");
    expect(moveHighlight(rows, "provider:slack", 1)).toBe("describe");
    expect(moveHighlight(rows, "describe", 1)).toBe("describe");
    expect(moveHighlight(rows, "describe", -1)).toBe("provider:slack");
    expect(moveHighlight(rows, "provider:slack", -1)).toBe("provider:slack");
  });

  it("has nothing to move to in an empty list", () => {
    expect(moveHighlight([], null, 1)).toBeNull();
  });
});

describe("insertOnEdge", () => {
  it("splices the step into the connection and keeps the rest of the flow", () => {
    const { graph, wait, filter, forward } = sample();
    const outcome = insertOnEdge(graph, catalog, forward, "filter");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || "reason" in outcome) return;
    const { node, graph: next } = outcome;
    expect(next.edges.some((edge) => edge.id === forward)).toBe(false);
    expect(
      next.edges.some(
        (edge) => edge.from.node === wait && edge.to.node === node.id,
      ),
    ).toBe(true);
    expect(
      next.edges.some(
        (edge) => edge.from.node === node.id && edge.to.node === filter,
      ),
    ).toBe(true);
    expect(graph.edges.some((edge) => edge.id === forward)).toBe(true);
  });

  it("refuses a loop's back-edge", () => {
    const { graph, loop } = sample();
    expect(insertOnEdge(graph, catalog, loop, "filter")).toEqual({
      ok: false,
      reason: "loop",
    });
  });

  it("refuses an end, which has no output to continue from", () => {
    const { graph, trigger, wait } = sample();
    const starting = graph.edges.find(
      (edge) => edge.from.node === trigger && edge.to.node === wait,
    );
    const outcome = insertOnEdge(graph, catalog, starting?.id ?? "", "end");
    expect(outcome.ok).toBe(false);
    if (outcome.ok || "reason" in outcome) return;
    expect(outcome.rejection.code).toBe("unknown_port");
  });

  it("reports an edge that is not in the graph", () => {
    const { graph } = sample();
    const outcome = insertOnEdge(graph, catalog, "missing", "filter");
    expect(outcome.ok).toBe(false);
    if (outcome.ok || "reason" in outcome) return;
    expect(outcome.rejection.code).toBe("unknown_edge");
  });
});
