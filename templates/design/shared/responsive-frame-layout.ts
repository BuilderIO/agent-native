/**
 * Geometry of one screen's responsive frame group: the primary frame plus the
 * breakpoint previews painted to its right.
 *
 * This lives in `shared/` because both sides of the contract need it. Actions
 * that *place* screens on the overview board (present-design-variants) must
 * reserve the same width the canvas will actually *paint*, or the next screen
 * lands underneath the previous screen's breakpoint row. Keeping the width in
 * one place is what makes writer and renderer agree.
 */

/** Gap between the primary frame and each breakpoint preview beside it. */
export const BREAKPOINT_FRAME_GAP = 24;

/** Drops any breakpoint whose width equals the primary frame's own width — a
 * redundant duplicate of the base — also cleaning up designs authored before
 * the default set excluded the primary width. */
export function visibleBreakpointWidths(
  breakpointWidths: readonly number[] | undefined,
  primaryWidthPx: number | undefined,
): number[] {
  const deduped = Array.from(
    new Set(
      (breakpointWidths ?? []).filter(
        (width) => Number.isFinite(width) && width > 0,
      ),
    ),
  );
  if (primaryWidthPx === undefined || !Number.isFinite(primaryWidthPx)) {
    return deduped;
  }
  return deduped.filter((width) => Math.abs(width - primaryWidthPx) > 1);
}

/**
 * Total painted width of a screen's frame group: the primary box plus every
 * breakpoint preview beside it, each drawn at the primary's own uniform
 * `scale`. `visibleWidths` must already be filtered through
 * `visibleBreakpointWidths` — callers differ in which width they dedupe
 * against, but the arithmetic must not.
 */
export function getResponsiveGroupWidth({
  primaryWidth,
  scale,
  visibleWidths,
}: {
  primaryWidth: number;
  scale: number;
  visibleWidths: readonly number[];
}): number {
  return visibleWidths.reduce(
    (total, width) => total + BREAKPOINT_FRAME_GAP + width * scale,
    Math.max(1, primaryWidth),
  );
}
