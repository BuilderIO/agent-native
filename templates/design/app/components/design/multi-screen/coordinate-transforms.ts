import { rotatePoint } from "@shared/canvas-math";

import type { FrameGeometry, Point } from "./types";

export interface ScreenViewport {
  width: number;
  height: number;
}

function frameCenter(frame: FrameGeometry): Point {
  return {
    x: frame.x + frame.width / 2,
    y: frame.y + frame.height / 2,
  };
}

/** Maps a point from an iframe/screen's local pixel space into board space. */
export function screenLocalPointToBoardPoint(
  point: Point,
  frame: FrameGeometry,
  viewport: ScreenViewport,
): Point {
  const unrotated = {
    x: frame.x + point.x * (frame.width / Math.max(1, viewport.width)),
    y: frame.y + point.y * (frame.height / Math.max(1, viewport.height)),
  };
  return rotatePoint(unrotated, frameCenter(frame), frame.rotation ?? 0);
}

/** Maps a board-space point into an iframe/screen's local pixel space. */
export function boardPointToScreenLocalPoint(
  point: Point,
  frame: FrameGeometry,
  viewport: ScreenViewport,
): Point {
  const unrotated = rotatePoint(
    point,
    frameCenter(frame),
    -(frame.rotation ?? 0),
  );
  return {
    x: (unrotated.x - frame.x) * (viewport.width / Math.max(1, frame.width)),
    y: (unrotated.y - frame.y) * (viewport.height / Math.max(1, frame.height)),
  };
}

/**
 * Maps an axis-aligned screen-local rect into the board. The returned geometry
 * keeps width/height in the screen's local axes and carries the screen's
 * rotation, matching the CSS box needed to render/hit-test it on the board.
 */
export function screenLocalRectToBoardGeometry(
  rect: { left: number; top: number; width: number; height: number },
  frame: FrameGeometry,
  viewport: ScreenViewport,
  minSize = 1,
): FrameGeometry {
  const scaleX = frame.width / Math.max(1, viewport.width);
  const scaleY = frame.height / Math.max(1, viewport.height);
  const width = Math.max(minSize, rect.width * scaleX);
  const height = Math.max(minSize, rect.height * scaleY);
  const unrotatedCenter = {
    // Preserve the historical local-left/local-top mapping even when a tiny
    // rect's rendered board size is clamped up to minSize.
    x: frame.x + rect.left * scaleX + width / 2,
    y: frame.y + rect.top * scaleY + height / 2,
  };
  const center = rotatePoint(
    unrotatedCenter,
    frameCenter(frame),
    frame.rotation ?? 0,
  );
  const rotation = frame.rotation ?? 0;
  return {
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
    ...(rotation ? { rotation } : {}),
  };
}
