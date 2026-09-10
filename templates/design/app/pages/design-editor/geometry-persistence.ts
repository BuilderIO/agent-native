import type {
  CanvasFrameGeometry,
  CanvasFrameGeometryById,
} from "@shared/canvas-frames";
import { quantizeToStep } from "@shared/canvas-math";

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

/** Separate from the sanity check below on purpose: an out-of-range frame is
 *  refused, a fractional one is repaired. Rewrites only what changes, so a
 *  whole-pixel board stays reference-equal and never dirties a save. */
export function quantizeCanvasFrameGeometryForPersist(
  geometryById: CanvasFrameGeometryById,
): CanvasFrameGeometryById {
  let quantized: CanvasFrameGeometryById | null = null;
  for (const [frameId, geometry] of Object.entries(geometryById)) {
    const next: CanvasFrameGeometry = { ...geometry };
    let changed = false;
    for (const key of ["x", "y", "width", "height"] as const) {
      const value = geometry[key];
      if (value === undefined) continue;
      const rounded = quantizeToStep(value);
      if (rounded === value) continue;
      next[key] = rounded;
      changed = true;
    }
    if (!changed) continue;
    if (quantized === null) quantized = { ...geometryById };
    quantized[frameId] = next;
  }
  return quantized ?? geometryById;
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
