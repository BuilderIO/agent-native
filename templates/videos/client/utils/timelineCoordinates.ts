/**
 * Timeline Coordinate Utilities
 * 
 * Centralized coordinate conversion logic for the Timeline component.
 * All conversions between pixels, frames, and percentages flow through these functions.
 */

/**
 * Convert a pixel delta to a frame delta based on the current view
 */
export function pxDeltaToFrameDelta(
  pxDelta: number,
  barWidth: number,
  viewDuration: number
): number {
  return Math.round((pxDelta / barWidth) * viewDuration);
}

/**
 * Convert a frame delta to a pixel delta based on the current view
 */
export function frameDeltaToPxDelta(
  frameDelta: number,
  barWidth: number,
  viewDuration: number
): number {
  return (frameDelta / viewDuration) * barWidth;
}

/**
 * Convert a frame number to a percentage position within the current view window
 * Returns a value between 0-100 representing the position in the view
 */
export function frameToViewPct(
  frame: number,
  viewStart: number,
  viewDuration: number
): number {
  return ((frame - viewStart) / viewDuration) * 100;
}

/**
 * Convert a client X coordinate (from mouse event) to a frame number
 */
export function clientXToFrame(
  clientX: number,
  barRect: DOMRect,
  viewStart: number,
  viewDuration: number
): number {
  const x = clientX - barRect.left;
  const fraction = Math.max(0, Math.min(1, x / barRect.width));
  return Math.round(viewStart + fraction * viewDuration);
}

/**
 * Clamp a frame number to valid bounds (0 to max)
 */
export function clampFrame(frame: number, max: number): number {
  return Math.max(0, Math.min(max, frame));
}

/**
 * Convert a percentage (0-100) within the view to a frame number
 */
export function viewPctToFrame(
  pct: number,
  viewStart: number,
  viewDuration: number
): number {
  return Math.round(viewStart + (pct / 100) * viewDuration);
}

/**
 * Calculate percentage change from pixel movement
 */
export function pxDeltaToPctChange(
  pxDelta: number,
  barWidth: number
): number {
  return (pxDelta / barWidth) * 100;
}
