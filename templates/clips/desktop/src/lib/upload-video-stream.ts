export interface VideoDimensions {
  width: number | null;
  height: number | null;
}

function isPositiveNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

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
