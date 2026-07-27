export interface VideoDimensions {
  width: number | null;
  height: number | null;
}

function isPositiveNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

/**
 * Whether upload capture needs a canvas-backed resize pass.
 *
 * Unknown dimensions stay on the defensive resize path. A source that is
 * already within the upload budget can go straight to MediaRecorder, avoiding
 * a full-frame draw on the renderer thread for every captured frame.
 */
export function shouldResampleVideoForUpload(
  dimensions: VideoDimensions,
  maxLongEdge: number,
): boolean {
  if (
    !isPositiveNumber(dimensions.width) ||
    !isPositiveNumber(dimensions.height)
  ) {
    return true;
  }
  return Math.max(dimensions.width, dimensions.height) > maxLongEdge;
}
