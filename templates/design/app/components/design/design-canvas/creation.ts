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
  /** Structured pen geometry, including Bezier handles and closed state. */
  penPath?: PenPath;
  fromClick: boolean;
  /** Commit an in-progress pen path without overriding a newly chosen tool. */
  preserveActiveTool?: boolean;
}

/**
 * A browser double-click is two complete pointer gestures followed by a
 * `dblclick` event. Both gestures therefore add the final pen anchor before
 * the overlay commits. Collapse only the coincident trailing pair, retaining
 * the anchor from the second gesture so the final clicked point is never
 * omitted from the committed path.
 */
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
