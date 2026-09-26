
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
): EdgeHandleHitGeometry {
  const outward = EDGE_HANDLE_HIT_OUTWARD_PX * chromeScale;
  const inward = clampHandleInwardReach(
    EDGE_HANDLE_HIT_INWARD_PX * chromeScale,
    frameDimension,
  );
  return { thickness: outward + inward, outwardOffset: -outward };
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
