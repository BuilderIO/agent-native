export const EDGE_HANDLE_HIT_OUTWARD_PX = 7;

export const EDGE_HANDLE_HIT_INWARD_PX = 7;

export const CORNER_HANDLE_SIZE_PX = 10;

export const HANDLE_MAX_INWARD_FRACTION = 0.25;

export function clampHandleInwardReach(
  nominalInward: number,
  frameDimension: number,
): number {
  if (!Number.isFinite(frameDimension) || frameDimension <= 0) {
    return nominalInward;
  }
  return Math.min(nominalInward, frameDimension * HANDLE_MAX_INWARD_FRACTION);
}

export interface EdgeHandleHitGeometry {
  thickness: number;
  outwardOffset: number;
}

export function getEdgeHandleHitGeometry(
  chromeScale: number,
  frameDimension: number,
  maxOutward = Number.POSITIVE_INFINITY,
): EdgeHandleHitGeometry {
  const outward = Math.min(
    EDGE_HANDLE_HIT_OUTWARD_PX * chromeScale,
    maxOutward,
  );
  const inward = clampHandleInwardReach(
    EDGE_HANDLE_HIT_INWARD_PX * chromeScale,
    frameDimension,
  );
  return { thickness: outward + inward, outwardOffset: -outward };
}

export type EdgeHandle = "n" | "s" | "e" | "w";

export interface HitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How far each edge's hit band may reach outward before it would cover one of
 * `obstacles` (another Screen's label row), so a click there picks that Screen.
 */
export function getEdgeOutwardReachClearOf(
  frame: HitRect,
  obstacles: HitRect[],
  outward: number,
): Record<EdgeHandle, number> {
  const reach = { n: outward, s: outward, e: outward, w: outward };
  const left = frame.x;
  const right = frame.x + frame.width;
  const top = frame.y;
  const bottom = frame.y + frame.height;
  for (const obstacle of obstacles) {
    const obstacleRight = obstacle.x + obstacle.width;
    const obstacleBottom = obstacle.y + obstacle.height;
    const overlapsX = obstacle.x < right && obstacleRight > left;
    const overlapsY = obstacle.y < bottom && obstacleBottom > top;
    if (overlapsX && obstacle.y < bottom + outward && obstacleBottom > bottom) {
      reach.s = Math.min(reach.s, Math.max(0, obstacle.y - bottom));
    }
    if (overlapsX && obstacleBottom > top - outward && obstacle.y < top) {
      reach.n = Math.min(reach.n, Math.max(0, top - obstacleBottom));
    }
    if (overlapsY && obstacle.x < right + outward && obstacleRight > right) {
      reach.e = Math.min(reach.e, Math.max(0, obstacle.x - right));
    }
    if (overlapsY && obstacleRight > left - outward && obstacle.x < left) {
      reach.w = Math.min(reach.w, Math.max(0, left - obstacleRight));
    }
  }
  return reach;
}

export interface CornerHandleGeometry {
  size: number;
  offsetX: number;
  offsetY: number;
}

export function getCornerHandleGeometry(
  chromeScale: number,
  frameWidth: number,
  frameHeight: number,
): CornerHandleGeometry {
  const size = CORNER_HANDLE_SIZE_PX * chromeScale;
  const inwardX = clampHandleInwardReach(size / 2, frameWidth);
  const inwardY = clampHandleInwardReach(size / 2, frameHeight);
  return { size, offsetX: inwardX - size, offsetY: inwardY - size };
}
