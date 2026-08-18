/**
 * Wheel/pinch → zoom-factor conversion.
 *
 * The two input devices are not comparable and must not share a sensitivity.
 * A mouse wheel emits coarse, discrete notches (one detent ≈ 100px in Chrome's
 * pixel delta mode); a trackpad pinch emits fine, often fractional deltas at a
 * far higher rate. Feeding both through one `exp(-deltaY * 0.01)` meant a
 * single mouse notch multiplied zoom by e¹ ≈ 2.72× — which is what made canvas
 * zoom feel uncontrollable next to Figma's ~1.1× per notch.
 *
 * The clamp applies to the resulting FACTOR, not to the accumulated delta.
 * Clamping the delta made the step frame-rate dependent: deltas accumulate
 * between animation frames, so a dropped frame silently doubled the distance
 * travelled. Clamping the factor means a dropped frame costs smoothness, never
 * distance.
 */

/** One mouse-wheel detent in `deltaMode === 0` pixels (Chrome/Safari). */
export const MOUSE_WHEEL_NOTCH_PX = 100;
/** Zoom multiplier for one full mouse-wheel notch, matching Figma's feel. */
export const ZOOM_STEP_PER_NOTCH = 1.1;
/** Multiplier exponent per pixel of trackpad pinch delta. */
export const PINCH_ZOOM_SENSITIVITY = 0.0075;
/** Ceiling on a single frame's zoom change, in either direction. */
export const MAX_ZOOM_FACTOR_PER_FRAME = 1.6;

/**
 * Whether a ctrl/meta-modified wheel delta came from a trackpad pinch rather
 * than a mouse wheel. Browsers report macOS pinch as a synthetic ctrl+wheel
 * with small, frequently fractional pixel deltas, while a real wheel detent is
 * a whole number near the notch size. Only meaningful for `deltaMode === 0`;
 * line/page modes are always discrete wheels and callers must not ask.
 */
export function isPinchZoomDelta(deltaY: number): boolean {
  if (!Number.isFinite(deltaY)) return false;
  return (
    !Number.isInteger(deltaY) || Math.abs(deltaY) < MOUSE_WHEEL_NOTCH_PX / 2
  );
}

/** Unclamped zoom multiplier for a wheel/pinch delta. Negative delta (scroll
 *  up / pinch open) zooms in, matching the browser's wheel convention. */
export function zoomFactorForWheelDelta(
  deltaY: number,
  pinch: boolean,
): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  return pinch
    ? Math.exp(-deltaY * PINCH_ZOOM_SENSITIVITY)
    : Math.pow(ZOOM_STEP_PER_NOTCH, -deltaY / MOUSE_WHEEL_NOTCH_PX);
}

/** Bounds one frame's zoom change symmetrically in multiplicative space, so
 *  zooming in and back out by the same clamped amount is a round trip. */
export function clampZoomFactor(factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return 1;
  return Math.min(
    MAX_ZOOM_FACTOR_PER_FRAME,
    Math.max(1 / MAX_ZOOM_FACTOR_PER_FRAME, factor),
  );
}

/** The zoom multiplier to apply for one flushed gesture frame. */
export function resolveZoomFactor(deltaY: number, pinch: boolean): number {
  return clampZoomFactor(zoomFactorForWheelDelta(deltaY, pinch));
}

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
