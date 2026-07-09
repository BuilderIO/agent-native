import type {
  CanvasFrameGeometry,
  CanvasFrameGeometryById,
} from "@shared/canvas-frames";

export function frameGeometryEquals(
  a: CanvasFrameGeometry | undefined,
  b: CanvasFrameGeometry | undefined,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function geometrySnapshotsEqual(
  a: CanvasFrameGeometryById,
  b: CanvasFrameGeometryById,
): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => key in b && frameGeometryEquals(a[key], b[key]));
}

export const MAX_SANE_FRAME_DIMENSION_PX = 100000;
export const MAX_SANE_FRAME_ASPECT_RATIO = 50;

export function isSaneCanvasFrameGeometryForPersist(
  geometry: CanvasFrameGeometry,
): boolean {
  const numericFields = [
    geometry.x,
    geometry.y,
    geometry.width,
    geometry.height,
    geometry.rotation,
    geometry.z,
  ];
  if (
    numericFields.some(
      (value) => value !== undefined && !Number.isFinite(value),
    )
  ) {
    return false;
  }
  const { width, height } = geometry;
  if (
    width !== undefined &&
    (width <= 0 || width > MAX_SANE_FRAME_DIMENSION_PX)
  ) {
    return false;
  }
  if (
    height !== undefined &&
    (height <= 0 || height > MAX_SANE_FRAME_DIMENSION_PX)
  ) {
    return false;
  }
  if (width !== undefined && height !== undefined) {
    const aspect = Math.max(width / height, height / width);
    if (aspect > MAX_SANE_FRAME_ASPECT_RATIO) return false;
  }
  return true;
}

export function sanitizeCanvasFrameGeometryForPersist(
  nextById: CanvasFrameGeometryById,
  previousById: CanvasFrameGeometryById,
  exemptFrameIds: readonly string[] = [],
): { geometryById: CanvasFrameGeometryById; rejectedFrameIds: string[] } {
  const rejectedFrameIds: string[] = [];
  let sanitized: CanvasFrameGeometryById | null = null;
  for (const [frameId, geometry] of Object.entries(nextById)) {
    if (exemptFrameIds.includes(frameId)) continue;
    if (isSaneCanvasFrameGeometryForPersist(geometry)) continue;
    rejectedFrameIds.push(frameId);
    if (sanitized === null) sanitized = { ...nextById };
    const previous = previousById[frameId];
    console.warn(
      "[design] rejected insane canvas frame geometry on persist — reverted to previous geometry",
      {
        frameId,
        rejected: geometry,
        revertedTo: previous ?? null,
      },
    );
    if (previous && isSaneCanvasFrameGeometryForPersist(previous)) {
      sanitized[frameId] = { ...previous };
    } else {
      delete sanitized[frameId];
    }
  }
  return { geometryById: sanitized ?? nextById, rejectedFrameIds };
}
