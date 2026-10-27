import type { Point } from "./types";

export function vectorEditLocalToCanvasPoint(
  local: Point,
  originCanvas: Point,
): Point {
  return { x: originCanvas.x + local.x, y: originCanvas.y + local.y };
}

export function vectorEditCanvasToLocalPoint(
  canvasPoint: Point,
  originCanvas: Point,
): Point {
  return {
    x: canvasPoint.x - originCanvas.x,
    y: canvasPoint.y - originCanvas.y,
  };
}
