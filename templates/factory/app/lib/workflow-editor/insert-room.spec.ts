import { describe, expect, it } from "vitest";

import {
  buildGraph,
  fixed,
  type NodeSpec,
} from "../../../server/workflow/story-graphs.fixture.js";
import type { WorkflowGraph } from "./engine.js";
import { makeRoomForInsert } from "./insert-room.js";
import { RANK_GAP, ROW_GAP } from "./layout.js";
import { NODE_TILE_HEIGHT, NODE_WIDTH } from "./node-metrics.js";
import type { Point } from "./types.js";

const start: NodeSpec = ["start", "trigger", { schedule: { every: "5m" } }];
const finish: NodeSpec = ["finish", "end", { outcome: "done" }];
const step = (name: string): NodeSpec => [
  name,
  "action",
  {
    operation: "slack.postMessage",
    args: { to: fixed("C1"), text: fixed("hello") },
  },
];

/** start, send, next and tail form a chain; other is wired to nothing. */
function graphAt(positions: Record<string, Point>): WorkflowGraph {
  const graph = buildGraph({
    nodes: [
      start,
      step("send"),
      step("next"),
      step("tail"),
      finish,
      step("other"),
    ],
    edges: [
      ["start", "out", "send"],
      ["send", "out", "next"],
      ["next", "out", "tail"],
      ["tail", "out", "finish"],
    ],
  });
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: positions[node.id],
    })),
  };
}

// Steps are one tile wide and tall. The layout puts columns a tile plus
// RANK_GAP apart, and rows a tile plus ROW_GAP apart.
const COLUMN = NODE_WIDTH + RANK_GAP;
const ROW = NODE_TILE_HEIGHT + ROW_GAP;

const layout = {
  start: { x: 0, y: 0 },
  send: { x: COLUMN, y: 0 },
  next: { x: 2 * COLUMN, y: 0 },
  tail: { x: 2 * COLUMN, y: 2 * ROW },
  finish: { x: 3 * COLUMN, y: 2 * ROW },
  other: { x: COLUMN, y: 2 * ROW },
};

describe("makeRoomForInsert", () => {
  it("moves nothing when the space at the insert point is clear", () => {
    expect(
      makeRoomForInsert(graphAt(layout), "start", { x: 0, y: ROW }),
    ).toEqual({});
  });

  it("shifts the row past the insert point and the chain downstream of it, leaving unrelated steps", () => {
    expect(
      makeRoomForInsert(graphAt(layout), "start", { x: COLUMN, y: 0 }),
    ).toEqual({
      send: { x: 2 * COLUMN, y: 0 },
      next: { x: 3 * COLUMN, y: 0 },
      tail: { x: 3 * COLUMN, y: 2 * ROW },
      finish: { x: 4 * COLUMN, y: 2 * ROW },
    });
  });
});
