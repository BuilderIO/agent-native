import type { CSSProperties } from "react";

/**
 * Shared compositing hint used to mitigate blank iframe previews at
 * fractional scale. Browser layer allocation and retention are implementation
 * details; this style does not guarantee a particular backing store.
 * Keep it transform-free so callers retain their own scale and positioning.
 * Variable-size canvas frames must also apply getIframePaintRetentionStyle.
 */
export const SCALED_IFRAME_PAINT_RETENTION_STYLE = {
  backfaceVisibility: "hidden",
} satisfies CSSProperties;

/**
 * Conservative per-axis limit for the retention hint, not a GPU texture
 * limit. Check the original viewport as well as any enlargement: low zoom
 * must not make an oversized imported iframe eligible for retention again.
 */
export const MAX_RETAINED_IFRAME_PAINT_AXIS_PX = 4096;

export function getIframePaintRetentionStyle(args: {
  viewportWidth: number;
  viewportHeight: number;
  effectiveScale: number;
}): CSSProperties {
  const scale =
    Number.isFinite(args.effectiveScale) && args.effectiveScale > 0
      ? args.effectiveScale
      : 1;
  const viewportWidth =
    Number.isFinite(args.viewportWidth) && args.viewportWidth > 0
      ? args.viewportWidth
      : 1280;
  const viewportHeight =
    Number.isFinite(args.viewportHeight) && args.viewportHeight > 0
      ? args.viewportHeight
      : 900;
  const paintedWidth = viewportWidth * Math.max(1, scale);
  const paintedHeight = viewportHeight * Math.max(1, scale);
  if (
    paintedWidth > MAX_RETAINED_IFRAME_PAINT_AXIS_PX ||
    paintedHeight > MAX_RETAINED_IFRAME_PAINT_AXIS_PX
  ) {
    // Explicitly override a retention hint already spread by the caller.
    return { backfaceVisibility: "visible" };
  }
  return SCALED_IFRAME_PAINT_RETENTION_STYLE;
}
