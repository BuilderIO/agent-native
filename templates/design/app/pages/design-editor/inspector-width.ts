// One value drives the inspector column, its head, and the canvas space it
// reserves, so every reader resolves the stored width through here.
export const DEFAULT_INSPECTOR_WIDTH = 280;
export const INSPECTOR_MIN_WIDTH = 240;
export const INSPECTOR_MAX_WIDTH = 400;
const INSPECTOR_WIDTH_STEP = 8;

/** Width the inspector renders at for the stored width. */
export function resolveInspectorWidth(storedWidth: number): number {
  return Math.max(
    Math.min(storedWidth, INSPECTOR_MAX_WIDTH),
    INSPECTOR_MIN_WIDTH,
  );
}

/** Width a drag or key press lands on: snapped to the step, then held inside the limits. */
export function snapInspectorDragWidth(width: number): number {
  const snapped =
    Math.round(width / INSPECTOR_WIDTH_STEP) * INSPECTOR_WIDTH_STEP;
  return resolveInspectorWidth(snapped);
}
