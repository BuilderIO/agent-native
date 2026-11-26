export const DEFAULT_INSPECTOR_WIDTH = 280;
export const INSPECTOR_MIN_WIDTH = 280;
export const INSPECTOR_MAX_WIDTH = 400;
const INSPECTOR_WIDTH_STEP = 8;

export function resolveInspectorWidth(storedWidth: number): number {
  return Math.max(
    Math.min(storedWidth, INSPECTOR_MAX_WIDTH),
    INSPECTOR_MIN_WIDTH,
  );
}

export function snapInspectorDragWidth(width: number): number {
  const snapped =
    Math.round(width / INSPECTOR_WIDTH_STEP) * INSPECTOR_WIDTH_STEP;
  return resolveInspectorWidth(snapped);
}
