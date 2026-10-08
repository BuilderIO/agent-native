export const MAX_PINCH_DELTA_PX = 40;

export const ZOOM_GESTURE_IDLE_RESET_MS = 150;

export type ZoomGestureDevice = {
  pinch: boolean;
  lastEventAtMs: number;
};

export function isPinchZoomDelta(deltaY: number): boolean {
  if (!Number.isFinite(deltaY)) return false;
  return Math.abs(deltaY) < MAX_PINCH_DELTA_PX;
}

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
  const looksLikePinch =
    deltaMode === 0 && ctrlKey && !metaKey && isPinchZoomDelta(deltaY);
  const continuesGesture =
    previous !== null &&
    Number.isFinite(previous.lastEventAtMs) &&
    at - previous.lastEventAtMs <= ZOOM_GESTURE_IDLE_RESET_MS;
  if (!continuesGesture) return { pinch: looksLikePinch, lastEventAtMs: at };
  return { pinch: previous.pinch && looksLikePinch, lastEventAtMs: at };
}

export const MOUSE_WHEEL_NOTCH_PX = 100;
export const ZOOM_STEP_PER_NOTCH = 1.1;
export const PINCH_ZOOM_SENSITIVITY = 0.0075;
export const MAX_ZOOM_FACTOR_PER_FRAME = 1.6;

export const WHEEL_LINE_HEIGHT_PX = 16;
export const WHEEL_PAGE_HEIGHT_PX = 800;

export function normalizeWheelDeltaPx(
  delta: number,
  deltaMode: number,
): number {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === 1) return delta * WHEEL_LINE_HEIGHT_PX;
  if (deltaMode === 2) return delta * WHEEL_PAGE_HEIGHT_PX;
  return delta;
}

export function zoomFactorForWheelDelta(
  deltaY: number,
  pinch: boolean,
): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  return pinch
    ? Math.exp(-deltaY * PINCH_ZOOM_SENSITIVITY)
    : Math.pow(ZOOM_STEP_PER_NOTCH, -deltaY / MOUSE_WHEEL_NOTCH_PX);
}

export function clampZoomFactor(factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return 1;
  return Math.min(
    MAX_ZOOM_FACTOR_PER_FRAME,
    Math.max(1 / MAX_ZOOM_FACTOR_PER_FRAME, factor),
  );
}

export function accumulateZoomFactor(
  pendingFactor: number,
  deltaY: number,
  pinch: boolean,
): number {
  const base =
    Number.isFinite(pendingFactor) && pendingFactor > 0 ? pendingFactor : 1;
  return base * zoomFactorForWheelDelta(deltaY, pinch);
}
