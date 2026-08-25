/**
 * Wheel/pinch → zoom-factor conversion, shared by every zoomable canvas.
 *
 * A mouse wheel and a trackpad pinch arrive as the same event type, their
 * deltas overlap, and the sensitivity each needs differs by roughly 8x — so a
 * surface that re-implements either half gets the split wrong the same way.
 */

/**
 * Largest |deltaY| finger separation produces; above it every device is a
 * wheel. macOS reports an accelerated mouse wheel as large FRACTIONAL deltas,
 * so fractionality alone cannot separate the two.
 */
export const MAX_PINCH_DELTA_PX = 40;

/**
 * A ctrl/meta wheel run with a longer gap than this starts a new gesture and
 * the device is classified again.
 */
export const ZOOM_GESTURE_IDLE_RESET_MS = 150;

/** Which curve a zoom gesture's deltas run through, latched for its duration. */
export type ZoomGestureDevice = {
  pinch: boolean;
  lastEventAtMs: number;
};

/**
 * Whether a delta is small enough to be finger separation. Magnitude only —
 * `resolveZoomGestureDevice` owns the modifier and delta-mode part of the
 * decision, and is what callers should ask.
 */
export function isPinchZoomDelta(deltaY: number): boolean {
  if (!Number.isFinite(deltaY)) return false;
  return Math.abs(deltaY) < MAX_PINCH_DELTA_PX;
}

/**
 * Latch the input device for a zoom gesture: one delta cannot identify a device
 * (macOS ramps an accelerated wheel up from pinch-sized values), so this only
 * ever loosens pinch → wheel, and re-decides after an idle gap.
 */
export function resolveZoomGestureDevice(args: {
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  atMs: number;
  previous: ZoomGestureDevice | null;
}): ZoomGestureDevice {
  const { deltaY, deltaMode, ctrlKey, metaKey, atMs, previous } = args;
  const at = Number.isFinite(atMs) ? atMs : 0;
  // Line/page modes are always discrete wheels. A held Cmd means the user
  // reached for a modifier, so the wheel is whatever device they are holding —
  // only the browser's synthetic ctrl+wheel can be a trackpad pinch.
  const looksLikePinch =
    deltaMode === 0 && ctrlKey && !metaKey && isPinchZoomDelta(deltaY);
  const continuesGesture =
    previous !== null &&
    Number.isFinite(previous.lastEventAtMs) &&
    at - previous.lastEventAtMs <= ZOOM_GESTURE_IDLE_RESET_MS;
  if (!continuesGesture) return { pinch: looksLikePinch, lastEventAtMs: at };
  return { pinch: previous.pinch && looksLikePinch, lastEventAtMs: at };
}

/** One mouse-wheel detent in `deltaMode === 0` pixels (Chrome/Safari). */
export const MOUSE_WHEEL_NOTCH_PX = 100;
/** Zoom multiplier for one full mouse-wheel notch, matching Figma's feel. */
export const ZOOM_STEP_PER_NOTCH = 1.1;
/** Multiplier exponent per pixel of trackpad pinch delta. */
export const PINCH_ZOOM_SENSITIVITY = 0.0075;
/** Ceiling on a single frame's zoom change, in either direction. */
export const MAX_ZOOM_FACTOR_PER_FRAME = 1.6;

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

/**
 * Fold one event into a frame's accumulated zoom. Both curves are exponential
 * in the delta, so multiplying per-event factors equals summing same-curve
 * deltas — and unlike a delta sum it stays exact when a frame catches two
 * curves, instead of forcing the accumulator to discard one of them.
 */
export function accumulateZoomFactor(
  pendingFactor: number,
  deltaY: number,
  pinch: boolean,
): number {
  const base =
    Number.isFinite(pendingFactor) && pendingFactor > 0 ? pendingFactor : 1;
  return base * zoomFactorForWheelDelta(deltaY, pinch);
}
