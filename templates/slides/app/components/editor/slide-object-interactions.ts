export const MIN_SLIDE_OBJECT_SIZE = 24;

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

export interface SlideObjectGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function moveSlideObject(
  start: SlideObjectGeometry,
  dx: number,
  dy: number,
): SlideObjectGeometry {
  return {
    ...start,
    x: start.x + dx,
    y: start.y + dy,
  };
}

export function resizeSlideObject(
  start: SlideObjectGeometry,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  options: { minSize?: number } = {},
): SlideObjectGeometry {
  const minSize = Math.max(1, options.minSize ?? MIN_SLIDE_OBJECT_SIZE);
  const fromWest = handle.includes("w");
  const fromNorth = handle.includes("n");

  let width = start.width + (fromWest ? -dx : dx);
  let height = start.height + (fromNorth ? -dy : dy);
  width = Math.max(minSize, width);
  height = Math.max(minSize, height);

  return {
    x: fromWest ? start.x + start.width - width : start.x,
    y: fromNorth ? start.y + start.height - height : start.y,
    width,
    height,
  };
}
