import dagre from "@dagrejs/dagre";

import type { WorkflowGraph, WorkflowNode } from "./engine.js";
import { NODE_HEADER_HEIGHT, NODE_WIDTH, nodeSize } from "./node-metrics.js";
import type { Point, Size } from "./types.js";

const RANK_GAP = 96;
const ROW_GAP = 40;
const COLLISION_MARGIN = 24;
const MAX_COORDINATE = 100_000;
const MAX_PLACEMENT_STEPS = 400;

function clampCoordinate(value: number): number {
  return Math.round(Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, value)));
}

function clampPoint(point: Point): Point {
  return { x: clampCoordinate(point.x), y: clampCoordinate(point.y) };
}

/**
 * Top-left positions for every node, left to right along forward edges. A
 * back-edge is left out of the ranking: it points against the flow by
 * design, and ranking it would fold the loop back over the nodes it exits.
 * The result keeps the graph's current top-left corner so the view does not
 * jump.
 */
export function layoutGraph(graph: WorkflowGraph): Record<string, Point> {
  if (graph.nodes.length === 0) return {};
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    ranksep: RANK_GAP,
    nodesep: ROW_GAP,
    marginx: 0,
    marginy: 0,
  });
  g.setDefaultEdgeLabel(() => ({}));
  const known = new Set<string>();
  for (const node of graph.nodes) {
    known.add(node.id);
    g.setNode(node.id, nodeSize(graph, node));
  }
  for (const edge of graph.edges) {
    if (edge.back || edge.from.node === edge.to.node) continue;
    if (known.has(edge.from.node) && known.has(edge.to.node)) {
      g.setEdge(edge.from.node, edge.to.node);
    }
  }
  dagre.layout(g);

  const originX = Math.min(...graph.nodes.map((node) => node.position.x));
  const originY = Math.min(...graph.nodes.map((node) => node.position.y));
  const placed = graph.nodes.map((node) => {
    const laid = g.node(node.id);
    return {
      id: node.id,
      x: laid.x - laid.width / 2,
      y: laid.y - laid.height / 2,
    };
  });
  const minX = Math.min(...placed.map((p) => p.x));
  const minY = Math.min(...placed.map((p) => p.y));
  return Object.fromEntries(
    placed.map((p) => [
      p.id,
      clampPoint({ x: p.x - minX + originX, y: p.y - minY + originY }),
    ]),
  );
}

interface Rect extends Point, Size {}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width + COLLISION_MARGIN &&
    a.x + a.width + COLLISION_MARGIN > b.x &&
    a.y < b.y + b.height + COLLISION_MARGIN &&
    a.y + a.height + COLLISION_MARGIN > b.y
  );
}

function nodeRects(graph: WorkflowGraph, skip?: ReadonlySet<string>): Rect[] {
  return graph.nodes
    .filter((node) => !skip?.has(node.id))
    .map((node) => ({ ...node.position, ...nodeSize(graph, node) }));
}

/** Moves `rect` down until it clears every rect in `others`. */
function slideDownUntilFree(rect: Rect, others: readonly Rect[]): Point {
  const step = rect.height + ROW_GAP;
  let y = rect.y;
  for (let i = 0; i < MAX_PLACEMENT_STEPS; i += 1) {
    const candidate = { ...rect, y };
    if (!others.some((other) => overlaps(candidate, other))) break;
    y += step;
  }
  return clampPoint({ x: rect.x, y });
}

const DEFAULT_NEW_NODE_SIZE: Size = {
  width: NODE_WIDTH,
  height: NODE_HEADER_HEIGHT,
};

/**
 * Where a new node goes so it does not sit on another one: to the right of
 * `after` when given, else centered on `near` (a point the user is looking
 * at), else below the existing nodes. A taken spot slides down to free space.
 */
export function fitNewNodePosition(
  graph: WorkflowGraph,
  options: {
    after?: string;
    near?: Point;
    size?: Size;
  } = {},
): Point {
  const size = options.size ?? DEFAULT_NEW_NODE_SIZE;
  const anchor = options.after
    ? graph.nodes.find((node) => node.id === options.after)
    : undefined;
  let start: Point;
  if (anchor) {
    start = {
      x: anchor.position.x + nodeSize(graph, anchor).width + RANK_GAP,
      y: anchor.position.y,
    };
  } else if (options.near) {
    start = {
      x: options.near.x - size.width / 2,
      y: options.near.y - size.height / 2,
    };
  } else if (graph.nodes.length > 0) {
    const rects = nodeRects(graph);
    start = {
      x: Math.min(...rects.map((r) => r.x)),
      y: Math.max(...rects.map((r) => r.y + r.height)) + ROW_GAP,
    };
  } else {
    start = { x: 0, y: 0 };
  }
  return slideDownUntilFree({ ...start, ...size }, nodeRects(graph));
}

/**
 * How far down to shift a copied group so it lands below the original and
 * clears every node outside it. Overlap is only untidy, so after the search
 * limit the last offset tried is used.
 */
export function fitGroupOffset(
  graph: WorkflowGraph,
  group: readonly WorkflowNode[],
): Point {
  const ids = new Set(group.map((node) => node.id));
  const rects = group.map((node) => ({
    ...node.position,
    ...nodeSize(graph, node),
  }));
  const top = Math.min(...rects.map((r) => r.y));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  const others = nodeRects(graph, ids);
  const step = ROW_GAP + (bottom - top);
  let dy = step;
  for (let i = 0; i < MAX_PLACEMENT_STEPS; i += 1) {
    const free = rects.every(
      (r) => !others.some((other) => overlaps({ ...r, y: r.y + dy }, other)),
    );
    if (free) break;
    dy += step;
  }
  return { x: 0, y: dy };
}
