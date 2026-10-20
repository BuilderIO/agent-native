import { describe, expect, it } from "vitest";

import {
  buildGraph,
  fixed,
  STORY_GRAPHS,
} from "../../../server/workflow/story-graphs.fixture.js";
import { fitGroupOffset, fitNewNodePosition, layoutGraph } from "./layout.js";
import { NODE_HEADER_HEIGHT, NODE_WIDTH } from "./node-metrics.js";

const graph = buildGraph({
  nodes: [
    ["start", "trigger", { schedule: { every: "5m" } }],
    [
      "send",
      "action",
      {
        operation: "slack.postMessage",
        args: { to: fixed("C1"), text: fixed("hi") },
      },
    ],
    ["finish", "end", { outcome: "done" }],
  ],
  edges: [
    ["start", "out", "send"],
    ["send", "out", "finish"],
  ],
});

describe("fitNewNodePosition", () => {
  it("starts an empty graph at the origin", () => {
    expect(fitNewNodePosition({ ...graph, nodes: [], edges: [] })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("puts a node to the right of the node it follows", () => {
    const at = fitNewNodePosition(graph, { after: "finish" });
    const finish = graph.nodes.find((n) => n.id === "finish")!;
    expect(at.x).toBeGreaterThanOrEqual(finish.position.x + NODE_WIDTH);
  });

  it("centers a node on the point the user is looking at", () => {
    const at = fitNewNodePosition(graph, { near: { x: 5_000, y: 5_000 } });
    expect(at).toEqual({
      x: 5_000 - NODE_WIDTH / 2,
      y: 5_000 - NODE_HEADER_HEIGHT / 2,
    });
  });

  it("slides past a node already in the spot", () => {
    const send = graph.nodes.find((n) => n.id === "send")!;
    const at = fitNewNodePosition(graph, {
      near: {
        x: send.position.x + NODE_WIDTH / 2,
        y: send.position.y + NODE_HEADER_HEIGHT / 2,
      },
    });
    expect(at.x).toBe(send.position.x);
    expect(at.y).toBeGreaterThan(send.position.y + NODE_HEADER_HEIGHT);
  });

  it("goes below the existing nodes when it has no hint", () => {
    const at = fitNewNodePosition(graph);
    const bottom =
      Math.max(...graph.nodes.map((n) => n.position.y)) + NODE_HEADER_HEIGHT;
    expect(at.y).toBeGreaterThanOrEqual(bottom);
  });

  it("stays inside the contract's coordinate bounds", () => {
    const at = fitNewNodePosition(graph, { near: { x: 9e9, y: -9e9 } });
    expect(at.x).toBeLessThanOrEqual(100_000);
    expect(at.y).toBeGreaterThanOrEqual(-100_000);
  });
});

describe("fitGroupOffset", () => {
  it("moves a copied group below everything it overlaps", () => {
    const group = graph.nodes.filter((n) => n.id !== "start");
    const offset = fitGroupOffset(graph, group);
    expect(offset.x).toBe(0);
    expect(offset.y).toBeGreaterThan(0);
  });
});

describe("layoutGraph", () => {
  it("returns nothing for an empty graph", () => {
    expect(layoutGraph({ ...graph, nodes: [], edges: [] })).toEqual({});
  });

  it("copes with a forward cycle in a graph that is not valid yet", () => {
    const cyclic = buildGraph({
      nodes: [
        ["a", "lookup", { operation: "slack.readThread", args: {} }],
        ["b", "lookup", { operation: "slack.readThread", args: {} }],
      ],
      edges: [
        ["a", "out", "b"],
        ["b", "out", "a"],
      ],
    });
    expect(Object.keys(layoutGraph(cyclic)).sort()).toEqual(["a", "b"]);
  });

  it("ignores edges that point at nodes that are gone", () => {
    const dangling = {
      ...graph,
      edges: [
        ...graph.edges,
        { id: "x", from: { node: "send", port: "out" }, to: { node: "ghost" } },
      ],
    };
    expect(Object.keys(layoutGraph(dangling)).sort()).toEqual([
      "finish",
      "send",
      "start",
    ]);
  });

  it("lays out every story within the contract's bounds", () => {
    for (const story of Object.values(STORY_GRAPHS)) {
      for (const { x, y } of Object.values(layoutGraph(story))) {
        expect(Math.abs(x)).toBeLessThanOrEqual(100_000);
        expect(Math.abs(y)).toBeLessThanOrEqual(100_000);
      }
    }
  });
});
