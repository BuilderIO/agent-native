/** The layout grid moves, resizes and new objects land on, in slide px. */
export const SLIDE_GRID_STEP_PX = 8;

/** The nearest grid line to `value`, in the slide root's own px. */
export function snapToSlideGridStep(value: number): number {
  return Math.round(value / SLIDE_GRID_STEP_PX) * SLIDE_GRID_STEP_PX;
}
