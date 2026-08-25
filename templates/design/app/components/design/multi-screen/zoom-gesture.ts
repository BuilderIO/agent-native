/**
 * Wheel/pinch zoom for the overview canvas.
 *
 * The device split and both curves are shared, because a surface that
 * re-implements either half reproduces the same mouse-reads-as-pinch bug.
 * Only the anchor below belongs to this surface.
 */
export {
  accumulateZoomFactor,
  clampZoomFactor,
  isPinchZoomDelta,
  MAX_PINCH_DELTA_PX,
  MAX_ZOOM_FACTOR_PER_FRAME,
  MOUSE_WHEEL_NOTCH_PX,
  PINCH_ZOOM_SENSITIVITY,
  resolveZoomGestureDevice,
  ZOOM_GESTURE_IDLE_RESET_MS,
  ZOOM_STEP_PER_NOTCH,
  zoomFactorForWheelDelta,
  type ZoomGestureDevice,
} from "@agent-native/core/client/zoom-gesture";

/** Anchor for an externally driven zoom change. Only hold the frame centre when
 *  it is on screen: a frame taller than the viewport has its centre off-screen,
 *  and holding an invisible point fixed pushes the visible part out of view. */
export function resolveExternalZoomAnchor(args: {
  frameCenter: { x: number; y: number } | null;
  surfaceSize: { width: number; height: number };
}): { x: number; y: number } {
  const { frameCenter, surfaceSize } = args;
  const viewportCenter = {
    x: surfaceSize.width / 2,
    y: surfaceSize.height / 2,
  };
  if (!frameCenter) return viewportCenter;
  if (
    !Number.isFinite(frameCenter.x) ||
    !Number.isFinite(frameCenter.y) ||
    surfaceSize.width <= 0 ||
    surfaceSize.height <= 0
  ) {
    return viewportCenter;
  }
  const onScreen =
    frameCenter.x >= 0 &&
    frameCenter.x <= surfaceSize.width &&
    frameCenter.y >= 0 &&
    frameCenter.y <= surfaceSize.height;
  return onScreen ? frameCenter : viewportCenter;
}
