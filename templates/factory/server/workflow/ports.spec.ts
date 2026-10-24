import { describe, expect, it } from "vitest";

import { NODE_KINDS, type NodeKind } from "./contract.js";
import {
  LIMIT_REACHED_PORT,
  STATIC_PORTS,
  portsFor,
  portsWithLimit,
  routePort,
} from "./ports.js";
import {
  buildGraph,
  parseNode,
  rule,
  type EdgeSpec,
  type NodeSpec,
} from "./story-graphs.fixture.js";

const settingsFor: Record<NodeKind, unknown> = {
  trigger: { schedule: { every: "5m" } },
  source: { source: "status", status: "automation_started", takeLimit: 5 },
  lookup: { operation: "slack.readThread", args: {} },
  action: { operation: "slack.postMessage", args: {} },
  filter: { combinator: "all", rules: [rule("item.kind", "equals", "x")] },
  switch: {
    routes: [
      {
        id: "a",
        label: "A",
        combinator: "all",
        rules: [rule("item.kind", "equals", "x")],
      },
      {
        id: "b",
        label: "B",
        combinator: "any",
        rules: [rule("item.kind", "equals", "y")],
      },
    ],
  },
  combine: { mode: "list" },
  split: { field: "item.list" },
  ai: {
    instruction: "Judge it.",
    mode: "perItem",
    result: { ok: { type: "boolean" } },
  },
  agent: { agent: "builder", op: "check", args: {} },
  wait: { wait: "reply" },
  end: { outcome: "done" },
};

describe("portsFor", () => {
  it.each([
    "trigger",
    "source",
    "lookup",
    "action",
    "combine",
    "split",
    "ai",
    "agent",
  ] as const)("gives a %s one out port", (kind) => {
    expect(portsFor(parseNode(kind, settingsFor[kind]))).toEqual(["out"]);
  });

  it("gives a filter match and otherwise", () => {
    expect(portsFor(parseNode("filter", settingsFor.filter))).toEqual([
      "match",
      "otherwise",
    ]);
  });

  it("gives a switch a port per route, then otherwise", () => {
    expect(portsFor(parseNode("switch", settingsFor.switch))).toEqual([
      "route:a",
      "route:b",
      "otherwise",
    ]);
    expect(routePort("a")).toBe("route:a");
  });

  it("lists a repeated route id once", () => {
    const route = {
      id: "a",
      label: "A",
      combinator: "all",
      rules: [rule("item.kind", "equals", "x")],
    };
    expect(portsFor(parseNode("switch", { routes: [route, route] }))).toEqual([
      "route:a",
      "otherwise",
    ]);
  });

  it("gives each kind of wait its own ports", () => {
    expect(portsFor(parseNode("wait", { wait: "reply" }))).toEqual([
      "replied",
      "timedOut",
    ]);
    expect(
      portsFor(
        parseNode("wait", {
          wait: "time",
          duration: { amount: 1, unit: "days" },
        }),
      ),
    ).toEqual(["done"]);
    expect(
      portsFor(
        parseNode("wait", {
          wait: "condition",
          operation: "sentry.issueStatus",
          args: {},
          rule: rule("item.status", "equals", "resolved"),
        }),
      ),
    ).toEqual(["met", "timedOut"]);
  });

  it("gives an end no ports", () => {
    expect(portsFor(parseNode("end", settingsFor.end))).toEqual([]);
  });

  it("answers for every one of the twelve kinds", () => {
    for (const kind of NODE_KINDS) {
      expect(Array.isArray(portsFor(parseNode(kind, settingsFor[kind])))).toBe(
        true,
      );
    }
    expect(Object.keys(STATIC_PORTS).sort()).toEqual(
      NODE_KINDS.filter((kind) => kind !== "switch" && kind !== "wait").sort(),
    );
  });

  it("returns a copy, so a caller cannot change the static map", () => {
    const node = parseNode("lookup", settingsFor.lookup);
    portsFor(node).push("mutated");
    expect(portsFor(node)).toEqual(["out"]);
  });
});

describe("portsWithLimit", () => {
  const nodes: NodeSpec[] = [
    ["ask", "action", { operation: "slack.postMessage", args: {} }],
    ["hold", "wait", { wait: "reply" }],
    ["done", "end", { outcome: "done" }],
  ];
  const edges = (back: boolean): EdgeSpec[] => [
    ["ask", "out", "hold"],
    ["hold", "replied", "ask", ...(back ? [2] : [])] as EdgeSpec,
    ["hold", "timedOut", "done"],
  ];

  it("adds limitReached to the node a back-edge leaves", () => {
    const graph = buildGraph({ nodes, edges: edges(true) });
    const hold = graph.nodes.find((node) => node.id === "hold")!;
    expect(portsWithLimit(graph, hold)).toEqual([
      "replied",
      "timedOut",
      LIMIT_REACHED_PORT,
    ]);
  });

  it("leaves other nodes alone, including the loop head", () => {
    const graph = buildGraph({ nodes, edges: edges(true) });
    const ask = graph.nodes.find((node) => node.id === "ask")!;
    expect(portsWithLimit(graph, ask)).toEqual(["out"]);
  });

  it("adds nothing when no edge is a back-edge", () => {
    const graph = buildGraph({ nodes, edges: edges(false) });
    const hold = graph.nodes.find((node) => node.id === "hold")!;
    expect(portsWithLimit(graph, hold)).toEqual(["replied", "timedOut"]);
  });

  it("adds it once however many back-edges leave the node", () => {
    const graph = buildGraph({
      nodes,
      edges: [
        ["ask", "out", "hold"],
        ["hold", "replied", "ask", 2],
        ["hold", "timedOut", "ask", 2],
      ],
    });
    const hold = graph.nodes.find((node) => node.id === "hold")!;
    expect(portsWithLimit(graph, hold)).toEqual([
      "replied",
      "timedOut",
      LIMIT_REACHED_PORT,
    ]);
  });
});
