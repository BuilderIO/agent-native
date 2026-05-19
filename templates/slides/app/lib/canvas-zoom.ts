export const MIN_CANVAS_ZOOM = 10;
export const MAX_CANVAS_ZOOM = 400;

export function computeCanvasFitZoom({
  viewportWidth,
  canvasWidth,
  horizontalPadding = 0,
  minZoom = MIN_CANVAS_ZOOM,
  maxZoom = 100,
}: {
  viewportWidth: number;
  canvasWidth: number;
  horizontalPadding?: number;
  minZoom?: number;
  maxZoom?: number;
}) {
  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(canvasWidth) ||
    canvasWidth <= 0
  ) {
    return maxZoom;
  }

  const availableWidth = viewportWidth - Math.max(0, horizontalPadding);
  if (availableWidth <= 0) return minZoom;

  return Math.max(
    minZoom,
    Math.min(maxZoom, Math.floor((availableWidth / canvasWidth) * 100)),
  );
}
