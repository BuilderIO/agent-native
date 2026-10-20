import { describe, expect, it } from "vitest";

import { OPERATION_CATALOG } from "../../../server/workflow/catalog/index.js";
import {
  buildGraph,
  fixed,
  fromPath,
  rule,
  STORY_GRAPHS,
  type NodeSpec,
  type EdgeSpec,
} from "../../../server/workflow/story-graphs.fixture.js";
import { firstOpenPort } from "./commands.js";
import { createWorkflowEditor, type WorkflowEditor } from "./editor.js";
import {
  NODE_KINDS,
  workflowGraphSchema,
  workflowNodeSchema,
  type WorkflowGraph,
} from "./engine.js";
import { SELECTION_CONTEXT_LIMIT } from "./selection.js";

const catalog = OPERATION_CATALOG;

const trigger: NodeSpec = ["start", "trigger", { schedule: { every: "5m" } }];
const finish: NodeSpec = ["finish", "end", { outcome: "done" }];
const post = (name: string, text: unknown = fixed("hello")): NodeSpec => [
  name,
  "action",
  {
    operation: "slack.postMessage",
    args: { to: fixed("C1"), text },
  },
];
const readThread = {
  operation: "slack.readThread",
  args: { channel: fixed("C1"), threadTs: fixed("1.1") },
};
const hold: NodeSpec = ["hold", "wait", { wait: "reply", limitHours: 24 }];

function edit(nodes: NodeSpec[], edges: EdgeSpec[]): WorkflowEditor {
  return createWorkflowEditor({ graph: buildGraph({ nodes, edges }), catalog });
}

function chain(): WorkflowEditor {
  return edit(
    [trigger, post("send"), finish],
    [
      ["start", "out", "send"],
      ["send", "out", "finish"],
    ],
  );
}

function graphOf(editor: WorkflowEditor): WorkflowGraph {
  return editor.getSnapshot().graph;
}

function rejectionOf(result: { ok: boolean; rejection?: { code: string } }) {
  expect(result.ok).toBe(false);
  return result.rejection?.code;
}

describe("addNode", () => {
  it.each(NODE_KINDS.filter((kind) => kind !== "trigger"))(
    "adds a %s node that passes the contract schema",
    (kind) => {
      const editor = createWorkflowEditor({
        graph: buildGraph({ nodes: [trigger], edges: [] }),
        catalog,
      });
      const result = editor.addNode(kind);
      expect(result.ok).toBe(true);
      const node = graphOf(editor).nodes.slice(-1)[0];
      expect(workflowNodeSchema.safeParse(node).success).toBe(true);
      expect(node.kind).toBe(kind);
      expect(node.id).toBe(node.name);
    },
  );

  it("adds every operation in the catalog as a node with no field issues", () => {
    const fieldCodes = [
      "unknown_operation",
      "operation_kind_mismatch",
      "unknown_field",
      "missing_required_field",
      "enum_value_invalid",
      "field_type_mismatch",
    ];
    for (const def of catalog.list()) {
      for (const kind of def.nodeKinds) {
        const editor = createWorkflowEditor({
          graph: buildGraph({ nodes: [trigger], edges: [] }),
          catalog,
        });
        const result = editor.addNode(kind, {
          operationId: def.id,
          variant: def.window && kind === "source" ? "window" : undefined,
        });
        expect(result.ok, `${def.id} as ${kind}`).toBe(true);
        if (!result.ok) continue;
        const issues = (editor.validate().byNode[result.node.id] ?? []).filter(
          (issue) => fieldCodes.includes(issue.code),
        );
        expect(issues, `${def.id} as ${kind}`).toEqual([]);
      }
    }
  });

  it("adds a trigger to an empty graph and refuses a second one", () => {
    const editor = createWorkflowEditor({
      graph: workflowGraphSchema.parse({ nodes: [], edges: [], settings: {} }),
      catalog,
    });
    expect(editor.addNode("trigger").ok).toBe(true);
    expect(rejectionOf(editor.addNode("trigger"))).toBe("trigger_exists");
    expect(graphOf(editor).nodes).toHaveLength(1);
  });

  it("gives each new node a distinct name and id", () => {
    const editor = chain();
    editor.addNode("filter");
    editor.addNode("filter");
    editor.addNode("filter");
    const names = graphOf(editor).nodes.map((node) => node.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining(["filter", "filter2", "filter3"]),
    );
  });

  it("picks the operation asked for and refuses one that cannot run there", () => {
    const editor = chain();
    const lookup = editor.addNode("lookup", {
      operationId: "slack.findUserByEmail",
    });
    expect(lookup.ok).toBe(true);
    expect(graphOf(editor).nodes.slice(-1)[0]?.settings).toMatchObject({
      operation: "slack.findUserByEmail",
    });
    expect(
      rejectionOf(
        editor.addNode("action", { operationId: "slack.readThread" }),
      ),
    ).toBe("operation_mismatch");
    expect(
      rejectionOf(editor.addNode("lookup", { operationId: "no.such" })),
    ).toBe("operation_mismatch");
    expect(
      rejectionOf(
        editor.addNode("filter", { operationId: "slack.readThread" }),
      ),
    ).toBe("operation_mismatch");
  });

  it("says so when the catalog has no operation for a node kind", () => {
    const editor = createWorkflowEditor({
      graph: buildGraph({ nodes: [trigger], edges: [] }),
      catalog: { get: () => undefined, list: () => [] },
    });
    expect(rejectionOf(editor.addNode("lookup"))).toBe("operation_required");
  });

  it("builds the source, wait and combine variants", () => {
    const editor = chain();
    editor.addNode("source", { variant: "status" });
    editor.addNode("source", { operationId: "hubspot.newLeads" });
    editor.addNode("source", { operationId: "github.listCommits" });
    editor.addNode("wait", { variant: "time" });
    editor.addNode("wait", { variant: "condition" });
    editor.addNode("combine", { variant: "summarize" });
    const added = graphOf(editor).nodes.slice(3);
    expect(added.map((node) => node.settings)).toMatchObject([
      { source: "status" },
      { source: "provider-query", operation: "hubspot.newLeads" },
      { source: "window", operation: "github.listCommits" },
      { wait: "time" },
      { wait: "condition" },
      { mode: "summarize" },
    ]);
  });

  it("connects the new node from `after`, selects it, and places it to the right", () => {
    const editor = edit(
      [trigger, hold, finish],
      [
        ["start", "out", "hold"],
        ["hold", "replied", "finish"],
        ["hold", "timedOut", "finish"],
      ],
    );
    const result = editor.addNode("action", {
      after: { node: "start", port: "out" },
    });
    expect(result.ok && result.edge).toBeTruthy();
    const graph = graphOf(editor);
    const start = graph.nodes.find((node) => node.id === "start")!;
    const added = graph.nodes.slice(-1)[0];
    expect(added.position.x).toBeGreaterThan(start.position.x);
    expect(editor.getSnapshot().selection).toEqual({
      nodeIds: [added.id],
      edgeIds: [],
    });
    expect(
      rejectionOf(
        editor.addNode("filter", { after: { node: "gone", port: "out" } }),
      ),
    ).toBe("unknown_node");
    expect(
      rejectionOf(
        editor.addNode("filter", { after: { node: "start", port: "nope" } }),
      ),
    ).toBe("unknown_port");
    expect(graphOf(editor).nodes).toHaveLength(graph.nodes.length);
  });

  it("does not drop a new node on top of an existing one", () => {
    const editor = chain();
    for (let i = 0; i < 6; i += 1) editor.addNode("filter");
    const rects = graphOf(editor).nodes.map((node) => node.position);
    const keys = new Set(rects.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(rects.length);
  });
});

describe("deleteElements", () => {
  it("removes a node with every edge attached to it", () => {
    const editor = chain();
    const result = editor.deleteElements({ nodeIds: ["send"] });
    expect(result.ok && result.removedEdgeIds.sort()).toEqual(["e1", "e2"]);
    expect(graphOf(editor).nodes.map((n) => n.id)).toEqual(["start", "finish"]);
    expect(graphOf(editor).edges).toEqual([]);
  });

  it("removes only the edge when an edge is deleted", () => {
    const editor = chain();
    editor.deleteElements({ edgeIds: ["e2"] });
    expect(graphOf(editor).nodes).toHaveLength(3);
    expect(graphOf(editor).edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("deletes the selection and clears it", () => {
    const editor = chain();
    editor.select({ nodeIds: ["send"] });
    editor.deleteSelection();
    expect(editor.getSnapshot().selection).toEqual({
      nodeIds: [],
      edgeIds: [],
    });
    expect(graphOf(editor).nodes).toHaveLength(2);
  });

  it("refuses ids that do not exist and leaves the graph alone", () => {
    const editor = chain();
    const before = graphOf(editor);
    expect(rejectionOf(editor.deleteElements({ nodeIds: ["nope"] }))).toBe(
      "unknown_node",
    );
    expect(rejectionOf(editor.deleteElements({ edgeIds: ["nope"] }))).toBe(
      "unknown_edge",
    );
    expect(graphOf(editor)).toBe(before);
    expect(editor.getSnapshot().canUndo).toBe(false);
  });

  it("drops the limit edge when the loop's target is deleted", () => {
    const editor = loop();
    expect(
      graphOf(editor).edges.some((e) => e.from.port === "limitReached"),
    ).toBe(true);
    editor.deleteElements({ nodeIds: ["fetch"] });
    const ports = graphOf(editor).edges.map((e) => e.from.port);
    expect(ports).not.toContain("limitReached");
  });
});

function loop(): WorkflowEditor {
  return edit(
    [trigger, ["fetch", "lookup", readThread], post("ask"), hold, finish],
    [
      ["start", "out", "fetch"],
      ["fetch", "out", "ask"],
      ["ask", "out", "hold"],
      ["hold", "replied", "fetch", 2],
      ["hold", "timedOut", "finish"],
      ["hold", "limitReached", "finish"],
    ],
  );
}

describe("duplicateNodes", () => {
  it("copies a node under a new id and name, below the original", () => {
    const editor = chain();
    const original = graphOf(editor).nodes.find((n) => n.id === "send")!;
    const result = editor.duplicateNodes(["send"]);
    expect(result.ok).toBe(true);
    const copy = graphOf(editor).nodes.slice(-1)[0];
    expect(copy.id).not.toBe("send");
    expect(copy.name).toBe(copy.id);
    expect(copy.settings).toEqual(original.settings);
    expect(copy.position.y).toBeGreaterThan(original.position.y);
    expect(editor.getSnapshot().selection.nodeIds).toEqual([copy.id]);
  });

  it("copies the edges that join two copied nodes and no others", () => {
    const editor = chain();
    const result = editor.duplicateNodes(["send", "finish"]);
    expect(result.ok).toBe(true);
    const graph = graphOf(editor);
    expect(graph.nodes).toHaveLength(5);
    expect(graph.edges).toHaveLength(3);
    const copied = graph.edges.slice(-1)[0];
    expect(copied.from.node).not.toBe("send");
    expect(copied.to.node).not.toBe("finish");
  });

  it("skips the trigger, and refuses when only the trigger is chosen", () => {
    const editor = chain();
    const result = editor.duplicateNodes(["start", "send"]);
    expect(result.ok && result.skipped).toEqual(["start"]);
    expect(rejectionOf(chain().duplicateNodes(["start"]))).toBe(
      "trigger_exists",
    );
  });

  it("gives a copied lookup its own `into` name", () => {
    const editor = edit(
      [
        trigger,
        ["thread", "lookup", { ...readThread, into: "history" }],
        finish,
      ],
      [
        ["start", "out", "thread"],
        ["thread", "out", "finish"],
      ],
    );
    editor.duplicateNodes(["thread"]);
    const copy = graphOf(editor).nodes.slice(-1)[0];
    expect(copy.kind === "lookup" && copy.settings.into).toBe("history2");
    expect(editor.validate().ok).toBe(false);
    expect(
      editor.validate().issues.some((i) => i.code === "duplicate_node_name"),
    ).toBe(false);
  });

  it("points a copied Wait's watch at the copied node when both are copied", () => {
    const editor = edit(
      [
        trigger,
        post("ask"),
        [
          "hold",
          "wait",
          { wait: "reply", limitHours: 24, watch: { fromNode: "ask" } },
        ],
        finish,
      ],
      [
        ["start", "out", "ask"],
        ["ask", "out", "hold"],
        ["hold", "replied", "finish"],
        ["hold", "timedOut", "finish"],
      ],
    );
    editor.duplicateNodes(["ask", "hold"]);
    const copies = graphOf(editor).nodes.slice(-2);
    const copiedWait = copies.find((n) => n.kind === "wait")!;
    const copiedAsk = copies.find((n) => n.kind === "action")!;
    expect(
      copiedWait.kind === "wait" &&
        copiedWait.settings.wait === "reply" &&
        copiedWait.settings.watch?.fromNode,
    ).toBe(copiedAsk.id);
  });
});

describe("moveNodes", () => {
  it("moves nodes, rounding and clamping to the contract's bounds", () => {
    const editor = chain();
    editor.moveNodes({ send: { x: 10.6, y: 250_000 } });
    const node = graphOf(editor).nodes.find((n) => n.id === "send")!;
    expect(node.position).toEqual({ x: 11, y: 100_000 });
    expect(workflowGraphSchema.safeParse(graphOf(editor)).success).toBe(true);
  });

  it("refuses an unknown node or a non-finite position", () => {
    const editor = chain();
    expect(rejectionOf(editor.moveNodes({ nope: { x: 0, y: 0 } }))).toBe(
      "unknown_node",
    );
    expect(
      rejectionOf(editor.moveNodes({ send: { x: Number.NaN, y: 0 } })),
    ).toBe("invalid_position");
  });

  it("is not an edit when nothing moves", () => {
    const editor = chain();
    const node = graphOf(editor).nodes[0];
    editor.moveNodes({ [node.id]: node.position });
    expect(editor.getSnapshot().canUndo).toBe(false);
  });
});

describe("renameNode", () => {
  it("renames one node and rewrites nothing else", () => {
    const graph = STORY_GRAPHS["bug-report-to-builder"];
    const editor = createWorkflowEditor({ graph, catalog });
    const result = editor.renameNode("assess", "judge");
    expect(result.ok).toBe(true);
    const after = graphOf(editor);
    expect(after.nodes.find((n) => n.id === "assess")?.name).toBe("judge");
    const strip = (g: WorkflowGraph) =>
      JSON.stringify({
        ...g,
        nodes: g.nodes.map((n) => (n.id === "assess" ? { ...n, name: "" } : n)),
      });
    expect(strip(after)).toBe(strip(graph));
  });

  it("reports the places that still read the old name", () => {
    const editor = createWorkflowEditor({
      graph: STORY_GRAPHS["bug-report-to-builder"],
      catalog,
    });
    const result = editor.renameNode("assess", "judge");
    expect(result.ok && result.references.map((r) => r.nodeId).sort()).toEqual(
      expect.arrayContaining(["route", "notifyOwner", "dismissed"]),
    );
    expect(
      result.ok && result.references.every((r) => r.nodeId !== "assess"),
    ).toBe(true);
    const stale = editor
      .validate()
      .issues.filter((i) => i.code === "bad_reference");
    expect(stale.length).toBeGreaterThan(0);
  });

  it("reports nothing when no expression reads the node", () => {
    const editor = chain();
    const result = editor.renameNode("send", "notify");
    expect(result.ok && result.references).toEqual([]);
  });

  it("refuses a name that is invalid or already taken", () => {
    const editor = chain();
    expect(rejectionOf(editor.renameNode("send", "not valid"))).toBe(
      "invalid_name",
    );
    expect(rejectionOf(editor.renameNode("send", "constructor"))).toBe(
      "invalid_name",
    );
    expect(rejectionOf(editor.renameNode("send", ""))).toBe("invalid_name");
    expect(rejectionOf(editor.renameNode("send", "finish"))).toBe(
      "duplicate_name",
    );
    expect(rejectionOf(editor.renameNode("nope", "x"))).toBe("unknown_node");
  });

  it("keeps the scope key, and so reports nothing, for a lookup that sets `into`", () => {
    const editor = createWorkflowEditor({
      graph: buildGraph({
        nodes: [
          trigger,
          ["thread", "lookup", { ...readThread, into: "history" }],
          post("send", fixed("{{ nodes.history.text }}")),
          finish,
        ],
        edges: [
          ["start", "out", "thread"],
          ["thread", "out", "send"],
          ["send", "out", "finish"],
        ],
      }),
      catalog,
    });
    const result = editor.renameNode("thread", "reader");
    expect(result.ok && result.references).toEqual([]);
    expect(editor.validate().issues).toEqual([]);
  });
});

describe("connect", () => {
  it("connects an output port to a node", () => {
    const editor = edit([trigger, post("send"), finish], []);
    const result = editor.connect({ node: "start", port: "out" }, "send");
    expect(result.ok && result.edge).toMatchObject({
      from: { node: "start", port: "out" },
      to: { node: "send" },
    });
    expect(graphOf(editor).edges).toHaveLength(1);
  });

  it.each([
    [
      "an unknown source node",
      { node: "nope", port: "out" },
      "send",
      "unknown_node",
    ],
    [
      "an unknown target node",
      { node: "start", port: "out" },
      "nope",
      "unknown_node",
    ],
    [
      "an unknown port",
      { node: "start", port: "match" },
      "send",
      "unknown_port",
    ],
    [
      "the trigger as a target",
      { node: "send", port: "out" },
      "start",
      "edge_into_trigger",
    ],
    ["a node onto itself", { node: "send", port: "out" }, "send", "self_loop"],
    [
      "a port an End does not have",
      { node: "finish", port: "out" },
      "send",
      "unknown_port",
    ],
  ])("refuses %s", (_name, from, to, code) => {
    const editor = edit([trigger, post("send"), finish], []);
    expect(rejectionOf(editor.connect(from, to))).toBe(code);
    expect(graphOf(editor).edges).toEqual([]);
    expect(editor.getSnapshot().canUndo).toBe(false);
  });

  it("refuses the same connection twice but allows a second edge from one port", () => {
    const editor = edit([trigger, post("one"), post("two"), finish], []);
    expect(editor.connect({ node: "start", port: "out" }, "one").ok).toBe(true);
    expect(
      rejectionOf(editor.connect({ node: "start", port: "out" }, "one")),
    ).toBe("duplicate_connection");
    expect(editor.connect({ node: "start", port: "out" }, "two").ok).toBe(true);
    expect(graphOf(editor).edges).toHaveLength(2);
  });

  it("allows a limitReached edge once a back-edge leaves the node", () => {
    const editor = edit(
      [trigger, ["fetch", "lookup", readThread], hold, finish],
      [
        ["start", "out", "fetch"],
        ["fetch", "out", "hold"],
        ["hold", "timedOut", "finish"],
        ["hold", "replied", "finish"],
      ],
    );
    expect(
      rejectionOf(
        editor.connect({ node: "hold", port: "limitReached" }, "finish"),
      ),
    ).toBe("unknown_port");
    editor.connect({ node: "hold", port: "replied" }, "fetch", {
      back: { maxIterations: 2 },
    });
    expect(
      editor.connect({ node: "hold", port: "limitReached" }, "finish").ok,
    ).toBe(true);
  });

  it("marks a connection back to an upstream node as a back-edge when asked to", () => {
    const editor = edit(
      [trigger, ["fetch", "lookup", readThread], hold, finish],
      [
        ["start", "out", "fetch"],
        ["fetch", "out", "hold"],
      ],
    );
    const forward = editor.connect(
      { node: "hold", port: "timedOut" },
      "finish",
      {
        back: "auto",
      },
    );
    expect(forward.ok && forward.edge.back).toBeUndefined();
    const back = editor.connect({ node: "hold", port: "replied" }, "fetch", {
      back: "auto",
    });
    expect(back.ok && back.edge.back).toEqual({ maxIterations: 3 });
  });

  it("lets only a Wait loop onto itself, and only as a back-edge", () => {
    const editor = edit([trigger, hold, finish], [["start", "out", "hold"]]);
    expect(
      rejectionOf(editor.connect({ node: "hold", port: "replied" }, "hold")),
    ).toBe("self_loop");
    expect(
      editor.connect({ node: "hold", port: "replied" }, "hold", {
        back: { maxIterations: 2 },
      }).ok,
    ).toBe(true);
    const plain = edit([trigger, post("send")], [["start", "out", "send"]]);
    expect(
      rejectionOf(
        plain.connect({ node: "send", port: "out" }, "send", {
          back: { maxIterations: 2 },
        }),
      ),
    ).toBe("self_loop");
  });

  it("refuses a loop cap outside 1 to 25 and a back-edge from limitReached", () => {
    const editor = loop();
    for (const maxIterations of [0, 26, 1.5, Number.NaN]) {
      expect(
        rejectionOf(
          editor.connect({ node: "ask", port: "out" }, "fetch", {
            back: { maxIterations },
          }),
        ),
      ).toBe("invalid_iterations");
    }
    expect(
      rejectionOf(
        editor.connect({ node: "hold", port: "limitReached" }, "ask", {
          back: { maxIterations: 2 },
        }),
      ),
    ).toBe("limit_port_back_edge");
  });
});

describe("disconnect and back-edges", () => {
  it("removes an edge", () => {
    const editor = chain();
    expect(editor.disconnect("e2").ok).toBe(true);
    expect(graphOf(editor).edges.map((e) => e.id)).toEqual(["e1"]);
    expect(rejectionOf(editor.disconnect("e2"))).toBe("unknown_edge");
  });

  it("removing the last back-edge takes the limit edge with it", () => {
    const editor = loop();
    const back = graphOf(editor).edges.find((e) => e.back)!;
    const result = editor.disconnect(back.id);
    expect(result.ok && result.removedEdgeIds).toHaveLength(2);
    expect(
      graphOf(editor).edges.some((e) => e.from.port === "limitReached"),
    ).toBe(false);
  });

  it("marks an edge as a back-edge with a cap and unmarks it", () => {
    const editor = edit(
      [trigger, ["fetch", "lookup", readThread], hold, finish],
      [
        ["start", "out", "fetch"],
        ["fetch", "out", "hold"],
        ["hold", "replied", "fetch"],
        ["hold", "timedOut", "finish"],
      ],
    );
    expect(editor.setBackEdge("e3", { maxIterations: 4 }).ok).toBe(true);
    expect(graphOf(editor).edges.find((e) => e.id === "e3")?.back).toEqual({
      maxIterations: 4,
    });
    expect(editor.setBackEdge("e3", { maxIterations: 7 }).ok).toBe(true);
    expect(graphOf(editor).edges.find((e) => e.id === "e3")?.back).toEqual({
      maxIterations: 7,
    });
    expect(editor.setBackEdge("e3", null).ok).toBe(true);
    expect(
      graphOf(editor).edges.find((e) => e.id === "e3")?.back,
    ).toBeUndefined();
    expect(rejectionOf(editor.setBackEdge("e3", { maxIterations: 0 }))).toBe(
      "invalid_iterations",
    );
    expect(rejectionOf(editor.setBackEdge("zzz", null))).toBe("unknown_edge");
  });

  it("unmarking the only back-edge prunes the limit edge and reports it", () => {
    const editor = loop();
    const back = graphOf(editor).edges.find((e) => e.back)!;
    const result = editor.setBackEdge(back.id, null);
    expect(result.ok && result.prunedEdgeIds).toHaveLength(1);
    expect(
      graphOf(editor).edges.some((e) => e.from.port === "limitReached"),
    ).toBe(false);
  });

  it("refuses to mark a limitReached edge as a back-edge", () => {
    const editor = loop();
    const limit = graphOf(editor).edges.find(
      (e) => e.from.port === "limitReached",
    )!;
    expect(
      rejectionOf(editor.setBackEdge(limit.id, { maxIterations: 2 })),
    ).toBe("limit_port_back_edge");
  });
});

describe("updateNodeSettings", () => {
  it("replaces the settings with a validated copy that carries schema defaults", () => {
    const editor = chain();
    const result = editor.updateNodeSettings("start", {
      schedule: { daily: { at: "09:30" } },
    });
    expect(result.ok).toBe(true);
    expect(graphOf(editor).nodes[0].settings).toEqual({
      schedule: { daily: { at: "09:30" } },
    });
    const wait = createWorkflowEditor({
      graph: buildGraph({ nodes: [trigger, hold, finish], edges: [] }),
      catalog,
    });
    const filled = wait.updateNodeSettings("hold", {
      wait: "reply",
    } as never);
    expect(filled.ok).toBe(true);
    expect(graphOf(wait).nodes[1].settings).toEqual({
      wait: "reply",
      limitHours: 24,
      acceptFrom: "anyone",
    });
  });

  it("refuses settings that do not fit the node and reports where", () => {
    const editor = chain();
    const before = graphOf(editor);
    const result = editor.updateNodeSettings("start", {
      schedule: { every: "7m" },
    } as never);
    expect(rejectionOf(result)).toBe("invalid_settings");
    expect(!result.ok && result.rejection.issues?.[0].path[0]).toBe("schedule");
    expect(
      rejectionOf(
        editor.updateNodeSettings("send", { outcome: "done" } as never),
      ),
    ).toBe("invalid_settings");
    expect(graphOf(editor)).toBe(before);
    expect(editor.getSnapshot().canUndo).toBe(false);
  });

  it("does not record an edit for settings that are already in place", () => {
    const editor = chain();
    const node = graphOf(editor).nodes[1];
    editor.updateNodeSettings(node.id, structuredClone(node.settings));
    expect(editor.getSnapshot().canUndo).toBe(false);
  });

  it("drops edges from ports a settings change removes", () => {
    const editor = edit(
      [
        trigger,
        [
          "route",
          "switch",
          {
            routes: [
              {
                id: "a",
                label: "A",
                combinator: "all",
                rules: [rule("item.title", "isEmpty")],
              },
              {
                id: "b",
                label: "B",
                combinator: "all",
                rules: [rule("item.title", "isEmpty")],
              },
            ],
          },
        ],
        post("one"),
        post("two"),
        finish,
      ],
      [
        ["start", "out", "route"],
        ["route", "route:a", "one"],
        ["route", "route:b", "two"],
        ["route", "otherwise", "finish"],
        ["one", "out", "finish"],
        ["two", "out", "finish"],
      ],
    );
    const result = editor.updateNodeSettings("route", {
      routes: [
        {
          id: "a",
          label: "A",
          combinator: "all",
          rules: [rule("item.title", "isEmpty")],
        },
      ],
    } as never);
    expect(result.ok && result.prunedEdgeIds).toEqual(["e3"]);
    expect(graphOf(editor).edges.map((e) => e.id)).not.toContain("e3");
    const wait = edit(
      [trigger, hold, finish],
      [
        ["start", "out", "hold"],
        ["hold", "replied", "finish"],
        ["hold", "timedOut", "finish"],
      ],
    );
    const switched = wait.updateNodeSettings("hold", {
      wait: "time",
      duration: { amount: 1, unit: "hours" },
    });
    expect(switched.ok && switched.prunedEdgeIds).toEqual(["e2", "e3"]);
  });

  it("folds settings edits that share a coalesce key into one undo step", () => {
    const editor = createWorkflowEditor({
      graph: buildGraph({ nodes: [trigger, finish], edges: [] }),
      catalog,
      now: () => 0,
    });
    const key = { key: "settings:finish" };
    editor.updateNodeSettings(
      "finish",
      { outcome: "dismissed", reason: "a" },
      key,
    );
    editor.updateNodeSettings(
      "finish",
      { outcome: "dismissed", reason: "ab" },
      key,
    );
    editor.updateNodeSettings(
      "finish",
      { outcome: "dismissed", reason: "abc" },
      key,
    );
    editor.undo();
    expect(graphOf(editor).nodes[1].settings).toEqual({ outcome: "done" });
    expect(editor.getSnapshot().canUndo).toBe(false);
  });
});

describe("undo and redo", () => {
  it("restores the graph and the selection", () => {
    const editor = chain();
    editor.select({ nodeIds: ["send"] });
    editor.deleteSelection();
    expect(graphOf(editor).nodes).toHaveLength(2);
    expect(editor.undo()).toBe(true);
    expect(graphOf(editor).nodes).toHaveLength(3);
    expect(editor.getSnapshot().selection.nodeIds).toEqual(["send"]);
    expect(editor.redo()).toBe(true);
    expect(graphOf(editor).nodes).toHaveLength(2);
    expect(editor.getSnapshot().selection.nodeIds).toEqual([]);
  });

  it("does nothing when there is nothing to undo or redo", () => {
    const editor = chain();
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(false);
  });

  it("drops the redo stack when a new edit follows an undo", () => {
    const editor = chain();
    editor.addNode("filter");
    editor.undo();
    expect(editor.getSnapshot().canRedo).toBe(true);
    editor.addNode("split");
    expect(editor.getSnapshot().canRedo).toBe(false);
  });

  it("keeps a bounded history", () => {
    const editor = createWorkflowEditor({
      graph: buildGraph({ nodes: [trigger], edges: [] }),
      catalog,
      historyLimit: 3,
    });
    for (let i = 0; i < 6; i += 1) editor.addNode("filter");
    let undone = 0;
    while (editor.undo()) undone += 1;
    expect(undone).toBe(3);
    expect(graphOf(editor).nodes).toHaveLength(4);
  });

  it("names the step it would undo and redo", () => {
    const editor = chain();
    editor.addNode("filter");
    expect(editor.getSnapshot().undoLabel).toBe("add-node");
    editor.undo();
    expect(editor.getSnapshot().redoLabel).toBe("add-node");
    expect(editor.getSnapshot().undoLabel).toBeUndefined();
  });

  it("folds a drag into one step, then starts a new step for the next drag", () => {
    const editor = chain();
    const start = graphOf(editor).nodes.find((n) => n.id === "send")!.position;
    const drag = { key: "drag:1" };
    for (let x = 1; x <= 20; x += 1) {
      editor.moveNodes({ send: { x: start.x + x, y: start.y } }, drag);
    }
    editor.moveNodes(
      { send: { x: start.x + 50, y: start.y } },
      { key: "drag:2" },
    );
    editor.undo();
    expect(graphOf(editor).nodes.find((n) => n.id === "send")!.position.x).toBe(
      start.x + 20,
    );
    editor.undo();
    expect(graphOf(editor).nodes.find((n) => n.id === "send")!.position.x).toBe(
      start.x,
    );
    expect(editor.getSnapshot().canUndo).toBe(false);
  });

  it("stops folding when the author pauses past the window", () => {
    let clock = 0;
    const editor = createWorkflowEditor({
      graph: buildGraph({ nodes: [trigger, finish], edges: [] }),
      catalog,
      now: () => clock,
    });
    const key = { key: "settings:finish", windowMs: 500 };
    editor.updateNodeSettings(
      "finish",
      { outcome: "dismissed", reason: "a" },
      key,
    );
    clock = 400;
    editor.updateNodeSettings(
      "finish",
      { outcome: "dismissed", reason: "ab" },
      key,
    );
    clock = 2_000;
    editor.updateNodeSettings(
      "finish",
      { outcome: "dismissed", reason: "abc" },
      key,
    );
    editor.undo();
    expect(graphOf(editor).nodes[1].settings).toMatchObject({ reason: "ab" });
    editor.undo();
    expect(graphOf(editor).nodes[1].settings).toEqual({ outcome: "done" });
  });

  it("does not fold into an older step after an undo", () => {
    const editor = chain();
    const drag = { key: "drag:1" };
    editor.moveNodes({ send: { x: 500, y: 0 } }, drag);
    editor.addNode("filter");
    editor.undo();
    editor.moveNodes({ send: { x: 600, y: 0 } }, drag);
    editor.undo();
    expect(graphOf(editor).nodes.find((n) => n.id === "send")!.position.x).toBe(
      500,
    );
  });

  it("can seal history so the next edit is its own step", () => {
    const editor = chain();
    const drag = { key: "drag:1" };
    editor.moveNodes({ send: { x: 500, y: 0 } }, drag);
    editor.sealHistory();
    editor.moveNodes({ send: { x: 600, y: 0 } }, drag);
    editor.undo();
    expect(graphOf(editor).nodes.find((n) => n.id === "send")!.position.x).toBe(
      500,
    );
  });
});

describe("replaceGraph", () => {
  it("clears history and reports the swap as external", () => {
    const editor = chain();
    editor.addNode("filter");
    const seen: string[] = [];
    editor.onGraphChange((_graph, source) => seen.push(source));
    const next = buildGraph({ nodes: [trigger, finish], edges: [] });
    editor.replaceGraph(next);
    expect(graphOf(editor)).toBe(next);
    expect(editor.getSnapshot().canUndo).toBe(false);
    expect(seen).toEqual(["external"]);
  });

  it("can keep history and record the swap as one step", () => {
    const editor = chain();
    const before = graphOf(editor);
    editor.replaceGraph(buildGraph({ nodes: [trigger, finish], edges: [] }), {
      keepHistory: true,
    });
    editor.undo();
    expect(graphOf(editor)).toBe(before);
  });

  it("drops selected ids the new graph no longer has", () => {
    const editor = chain();
    editor.select({ nodeIds: ["send"] });
    editor.replaceGraph(buildGraph({ nodes: [trigger, finish], edges: [] }));
    expect(editor.getSnapshot().selection.nodeIds).toEqual([]);
  });
});

describe("change notifications", () => {
  it("tells graph listeners about edits, undo and redo but not selection", () => {
    const editor = chain();
    const seen: string[] = [];
    editor.onGraphChange((_graph, source) => seen.push(source));
    editor.select({ nodeIds: ["send"] });
    editor.addNode("filter");
    editor.undo();
    editor.redo();
    expect(seen).toEqual(["edit", "undo", "redo"]);
  });

  it("does not notify for a rejected command or an unchanged selection", () => {
    const editor = chain();
    let notified = 0;
    editor.subscribe(() => {
      notified += 1;
    });
    editor.connect({ node: "start", port: "nope" }, "send");
    editor.select({});
    expect(notified).toBe(0);
    editor.select({ nodeIds: ["send"] });
    editor.select({ nodeIds: ["send"] });
    expect(notified).toBe(1);
  });

  it("hands React a new snapshot object only when something changed", () => {
    const editor = chain();
    const first = editor.getSnapshot();
    editor.select({});
    expect(editor.getSnapshot()).toBe(first);
    editor.select({ nodeIds: ["send"] });
    expect(editor.getSnapshot()).not.toBe(first);
  });
});

describe("selection", () => {
  it("ignores ids that are not in the graph and orders the rest", () => {
    const editor = chain();
    editor.select({
      nodeIds: ["finish", "ghost", "start"],
      edgeIds: ["e2", "x"],
    });
    expect(editor.getSnapshot().selection).toEqual({
      nodeIds: ["start", "finish"],
      edgeIds: ["e2"],
    });
  });

  it("selects everything and clears it", () => {
    const editor = chain();
    editor.selectAll();
    expect(editor.getSnapshot().selection).toEqual({
      nodeIds: ["start", "send", "finish"],
      edgeIds: ["e1", "e2"],
    });
    editor.clearSelection();
    expect(editor.getSnapshot().selection).toEqual({
      nodeIds: [],
      edgeIds: [],
    });
  });

  it("describes the selection in a small plain object", () => {
    const editor = chain();
    editor.select({ nodeIds: ["send"], edgeIds: ["e1"] });
    const context = editor.getSelectionContext();
    expect(context).toEqual({
      nodeCount: 3,
      edgeCount: 2,
      selectedNodes: [
        {
          id: "send",
          name: "send",
          kind: "action",
          operation: "slack.postMessage",
        },
      ],
      selectedEdges: [{ id: "e1", from: "start", port: "out", to: "send" }],
      truncated: false,
    });
    expect(JSON.parse(JSON.stringify(context))).toEqual(context);
  });

  it("bounds the selection context however much is selected", () => {
    const graph = STORY_GRAPHS["builder-to-merge"];
    const editor = createWorkflowEditor({ graph, catalog });
    editor.selectAll();
    const context = editor.getSelectionContext();
    expect(context.selectedNodes).toHaveLength(SELECTION_CONTEXT_LIMIT);
    expect(context.selectedEdges.length).toBeLessThanOrEqual(
      SELECTION_CONTEXT_LIMIT,
    );
    expect(context.truncated).toBe(true);
    expect(JSON.stringify(context).length).toBeLessThan(4_000);
  });

  it("names an agent node by its operation", () => {
    const editor = createWorkflowEditor({
      graph: STORY_GRAPHS["bug-report-to-builder"],
      catalog,
    });
    editor.select({ nodeIds: ["startBuilder"] });
    expect(editor.getSelectionContext().selectedNodes[0]).toMatchObject({
      kind: "agent",
      operation: "builder.start",
    });
  });
});

describe("validate", () => {
  it("files the validator's issues under the node and edge they name", () => {
    const editor = edit(
      [trigger, post("send"), post("orphan"), finish],
      [
        ["start", "out", "send"],
        ["send", "out", "finish"],
      ],
    );
    const validation = editor.validate();
    expect(validation.ok).toBe(false);
    expect(validation.byNode.orphan.map((i) => i.code)).toEqual(
      expect.arrayContaining(["unreachable_node", "port_leads_nowhere"]),
    );
    expect(validation.byNode.send).toBeUndefined();
  });

  it("keys back-edge issues by edge id and keeps trigger-count issues graph-level", () => {
    const editor = edit(
      [trigger, ["fetch", "lookup", readThread], post("ask"), finish],
      [
        ["start", "out", "fetch"],
        ["fetch", "out", "ask"],
        ["ask", "out", "finish"],
        ["ask", "out", "fetch", 2],
      ],
    );
    const validation = editor.validate();
    expect(validation.byEdge.e4.map((i) => i.code)).toContain(
      "loop_without_wait",
    );
    const noTrigger = createWorkflowEditor({
      graph: buildGraph({
        nodes: [post("send"), finish],
        edges: [["send", "out", "finish"]],
      }),
      catalog,
    });
    expect(noTrigger.validate().graphLevel.map((i) => i.code)).toContain(
      "trigger_count",
    );
  });

  it("reuses the result until the graph changes", () => {
    const editor = chain();
    const first = editor.validate();
    editor.select({ nodeIds: ["send"] });
    expect(editor.validate()).toBe(first);
    editor.addNode("filter");
    expect(editor.validate()).not.toBe(first);
  });

  it("reads a field binding mode the editor can hand back", () => {
    const editor = chain();
    const result = editor.updateNodeSettings("send", {
      operation: "slack.postMessage",
      args: { to: fromPath("settings.digestChannel"), text: fixed("hi") },
    } as never);
    expect(result.ok).toBe(true);
    expect(editor.validate().ok).toBe(true);
  });
});

describe("firstOpenPort", () => {
  it("finds the first output nothing leaves yet", () => {
    const editor = edit(
      [trigger, hold, finish],
      [
        ["start", "out", "hold"],
        ["hold", "replied", "finish"],
      ],
    );
    expect(firstOpenPort(graphOf(editor), "hold")).toBe("timedOut");
    expect(firstOpenPort(graphOf(editor), "start")).toBeUndefined();
    expect(firstOpenPort(graphOf(editor), "finish")).toBeUndefined();
    expect(firstOpenPort(graphOf(editor), "nope")).toBeUndefined();
  });
});
