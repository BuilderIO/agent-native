import type { WorkflowGraph, WorkflowNode } from "./engine.js";
import { RANK_GAP } from "./layout.js";
import { NODE_TILE_HEIGHT, NODE_WIDTH, nodeSize } from "./node-metrics.js";
import type { Point, Size } from "./types.js";

/** How far a row of steps moves right to make room for one more step: one column. */
const ROOM_SHIFT = NODE_WIDTH + RANK_GAP;
/** A step this close above or below the insert row moves with the row. */
const ROW_REACH = 192;
/** Space kept clear to the right of the new step, so it does not touch the next one. */
const ROOM_MARGIN = 16;
const DEFAULT_TILE: Size = { width: NODE_WIDTH, height: NODE_TILE_HEIGHT };

interface Box extends Point, Size {}

function boxOf(graph: WorkflowGraph, node: WorkflowNode): Box {
  return { ...node.position, ...nodeSize(graph, node) };
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * New positions that make room for a step at `insertLeft` (its top-left corner).
 * Nothing moves when that space is clear. Otherwise every step in the insert row
 * whose right edge is past the insert x moves right by one column, and so does
 * every step reachable from one of them by a forward edge, however far down it
 * sits. `sourceId` is the step the new one goes after; its box is not tested
 * against the space. `tile` is the new step's size and defaults to a tile with
 * up to two handles.
 */
export function makeRoomForInsert(
  graph: WorkflowGraph,
  sourceId: string,
  insertLeft: Point,
  tile: Size = DEFAULT_TILE,
): Record<string, Point> {
  const room: Box = {
    x: insertLeft.x,
    y: insertLeft.y,
    width: tile.width + ROOM_MARGIN,
    height: tile.height,
  };
  const steps = graph.nodes.map((node) => ({ node, box: boxOf(graph, node) }));
  const blocked = steps.some(
    ({ node, box }) => node.id !== sourceId && overlaps(room, box),
  );
  if (!blocked) return {};

  // Right edge past the insert x is the whole test: a step that starts at or
  // after the x also ends past it.
  const inRow = (box: Box) =>
    box.y <= room.y + room.height + ROW_REACH &&
    box.y + box.height >= room.y - ROW_REACH;
  const moving = new Set(
    steps
      .filter(({ box }) => inRow(box) && box.x + box.width > insertLeft.x)
      .map(({ node }) => node.id),
  );
  const queue = [...moving];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    for (const edge of graph.edges) {
      if (edge.back || edge.from.node !== id || moving.has(edge.to.node)) {
        continue;
      }
      moving.add(edge.to.node);
      queue.push(edge.to.node);
    }
  }
  return Object.fromEntries(
    steps
      .filter(({ node }) => moving.has(node.id))
      .map(({ node }) => [
        node.id,
        { x: node.position.x + ROOM_SHIFT, y: node.position.y },
      ]),
  );
}
