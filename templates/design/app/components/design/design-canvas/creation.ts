import type { PenPath } from "@shared/pen-path";

export type CreationTool =
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "text"
  | "pen"
  | "frame";

export interface CreatePrimitiveSpec {
  tool: CreationTool;
  rect?: { x: number; y: number; width: number; height: number };
  points?: Array<{ x: number; y: number }>;
  penPath?: PenPath;
  fromClick: boolean;
  preserveActiveTool?: boolean;
  nextTool?: "move" | "pen";
}

export function collapseDoubleClickPenAnchor(path: PenPath): PenPath {
  const last = path.nodes[path.nodes.length - 1];
  const previous = path.nodes[path.nodes.length - 2];
  if (
    !last ||
    !previous ||
    Math.hypot(
      last.point.x - previous.point.x,
      last.point.y - previous.point.y,
    ) > 0.5
  ) {
    return path;
  }
  return {
    nodes: [...path.nodes.slice(0, -2), last],
    closed: false,
  };
}
