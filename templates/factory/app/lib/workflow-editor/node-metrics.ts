import {
  OUT_PORT,
  portsWithLimit,
  type WorkflowGraph,
  type WorkflowNode,
} from "./engine.js";
import type { Size } from "./types.js";

// The canvas styles nodes to exactly these numbers, so layout can place nodes
// before the browser has measured them. A node is its icon tile: the name and
// summary under the tile take no layout room, the gaps in layout.ts leave it.
export const NODE_WIDTH = 96;
/** The height of a tile with up to two handles on its busier side. */
export const NODE_TILE_HEIGHT = 96;
/** Each handle past two on the busier side adds this much, so handles stay 32 px apart. */
const HANDLE_STEP = 32;

/** A lone `out` port needs no label, so its handle sits at the tile's middle with nothing beside it. */
export function showsPortRows(ports: readonly string[]): boolean {
  return ports.length > 0 && !(ports.length === 1 && ports[0] === OUT_PORT);
}

/** Tile height from the busier side: one input for every step but a trigger, one output per port. */
export function nodeSize(graph: WorkflowGraph, node: WorkflowNode): Size {
  const inputs = node.kind === "trigger" ? 0 : 1;
  const outputs = portsWithLimit(graph, node).length;
  const handles = Math.max(inputs, outputs);
  return {
    width: NODE_WIDTH,
    height: NODE_TILE_HEIGHT + HANDLE_STEP * Math.max(0, handles - 2),
  };
}
