import type { Point } from "./types";

/** Path-local point -> canvas-space point, given the path's canvas origin. */
export function vectorEditLocalToCanvasPoint(
  local: Point,
  originCanvas: Point,
): Point {
  return { x: originCanvas.x + local.x, y: originCanvas.y + local.y };
}

/** Canvas-space point -> path-local point, given the path's canvas origin.
 *  Inverse of `vectorEditLocalToCanvasPoint`. */
export function vectorEditCanvasToLocalPoint(
  canvasPoint: Point,
  originCanvas: Point,
): Point {
  return {
    x: canvasPoint.x - originCanvas.x,
    y: canvasPoint.y - originCanvas.y,
  };
}
