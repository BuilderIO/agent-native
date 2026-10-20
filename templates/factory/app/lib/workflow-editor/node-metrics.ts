import {
  OUT_PORT,
  portsWithLimit,
  type WorkflowGraph,
  type WorkflowNode,
} from "./engine.js";
import type { Size } from "./types.js";

// The canvas styles nodes to exactly these numbers, so layout can place nodes
// before the browser has measured them.
export const NODE_WIDTH = 248;
export const NODE_HEADER_HEIGHT = 56;
const PORT_ROW_HEIGHT = 24;
const NODE_FOOTER_PADDING = 8;

/** A lone `out` port needs no label, so its handle sits on the header. */
export function showsPortRows(ports: readonly string[]): boolean {
  return ports.length > 0 && !(ports.length === 1 && ports[0] === OUT_PORT);
}

export function nodeSize(graph: WorkflowGraph, node: WorkflowNode): Size {
  const ports = portsWithLimit(graph, node);
  const rows = showsPortRows(ports)
    ? ports.length * PORT_ROW_HEIGHT + NODE_FOOTER_PADDING
    : 0;
  return { width: NODE_WIDTH, height: NODE_HEADER_HEIGHT + rows };
}
