export const MIN_CANVAS_ZOOM = 10;
export const MAX_CANVAS_ZOOM = 400;

export function computeCanvasFitZoom({
  viewportWidth,
  viewportHeight,
  canvasWidth,
  canvasHeight,
  horizontalPadding = 0,
  verticalPadding = 0,
  fillViewport = false,
  minZoom = MIN_CANVAS_ZOOM,
  maxZoom = fillViewport ? MAX_CANVAS_ZOOM : 100,
}: {
  viewportWidth: number;
  viewportHeight?: number;
  canvasWidth: number;
  canvasHeight?: number;
  horizontalPadding?: number;
  verticalPadding?: number;
  /** Scale past 100% and keep sub-percent precision so the canvas spans the
   * viewport exactly instead of stopping up to a percent short. */
  fillViewport?: boolean;
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
  const widthZoom = (availableWidth / canvasWidth) * 100;
  const heightZoom =
    typeof viewportHeight === "number" &&
    Number.isFinite(viewportHeight) &&
    typeof canvasHeight === "number" &&
    Number.isFinite(canvasHeight) &&
    canvasHeight > 0
      ? ((viewportHeight - Math.max(0, verticalPadding)) / canvasHeight) * 100
      : widthZoom;

  const fitZoom = Math.min(widthZoom, heightZoom);
  return Math.max(
    minZoom,
    Math.min(maxZoom, fillViewport ? fitZoom : Math.floor(fitZoom)),
  );
}
