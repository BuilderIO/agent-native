/**
 * Pure index math for HTML5 drag-and-drop tab reordering. Extracted so it's
 * unit-testable without mounting EditorTabs.
 */

/**
 * Resolve the drop target index for a tab dragged from `fromIndex` and
 * dropped over `overIndex`, given whether the pointer is in the left/right
 * half of the hovered tab. Mirrors VS Code's tab reorder feel: dropping on
 * the left half of a tab inserts before it, the right half inserts after.
 */
export function resolveTabDropIndex(
  fromIndex: number,
  overIndex: number,
  dropOnRightHalf: boolean,
): number {
  let toIndex = dropOnRightHalf ? overIndex + 1 : overIndex;
  // Reducing the array by removing `fromIndex` shifts later indices down by
  // one before the re-insertion happens.
  if (fromIndex < toIndex) toIndex -= 1;
  return toIndex;
}

/** True when a reorder from `fromIndex` to `toIndex` is a real move. */
export function isTabReorderNoop(fromIndex: number, toIndex: number): boolean {
  return fromIndex < 0 || toIndex < 0 || fromIndex === toIndex;
}
