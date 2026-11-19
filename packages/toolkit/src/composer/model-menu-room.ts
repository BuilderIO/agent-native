/**
 * How much room the composer's model menu may use above its trigger.
 *
 * The menu opens upward from the trigger, and the composer's box extends further up than the trigger
 * does, so a fixed offset covers the reply box. The room is the distance from the trigger's top to the composer root's top,
 * plus a small gap; the menu's own height is capped to the space above it so a long menu scrolls
 * instead of spilling over the box or flipping underneath it.
 */
export const MODEL_MENU_MIN_OFFSET = 6;
export const MODEL_MENU_GAP = 8;
export const MODEL_MENU_MIN_HEIGHT = 160;
export const MODEL_MENU_TOP_PADDING = 16;

export function modelMenuRoom(input: {
  triggerTop: number;
  composerTop: number | null;
  viewportTop?: number;
}): { offset: number; maxHeight: number } {
  const viewportTop = input.viewportTop ?? 0;
  // No composer root means there is nothing to clear, so keep the minimum gap rather than the gap
  // plus an empty clearance.
  const clearance =
    input.composerTop === null ? null : input.triggerTop - input.composerTop;
  return {
    offset:
      clearance === null
        ? MODEL_MENU_MIN_OFFSET
        : Math.max(
            MODEL_MENU_MIN_OFFSET,
            Math.round(clearance) + MODEL_MENU_GAP,
          ),
    maxHeight: Math.max(
      MODEL_MENU_MIN_HEIGHT,
      Math.round(input.triggerTop - viewportTop - MODEL_MENU_TOP_PADDING),
    ),
  };
}
