import type { CSSProperties } from "react";

export const SCALED_IFRAME_PAINT_RETENTION_STYLE = {
  backfaceVisibility: "hidden",
} satisfies CSSProperties;

export const MAX_RETAINED_IFRAME_PAINT_AXIS_PX = 4096;

export function getIframePaintRetentionStyle(args: {
  viewportWidth: number;
  viewportHeight: number;
  effectiveScale: number;
  effectiveScaleY?: number;
}): CSSProperties {
  const scaleX =
    Number.isFinite(args.effectiveScale) && args.effectiveScale > 0
      ? args.effectiveScale
      : 1;
  const requestedScaleY = args.effectiveScaleY;
  const scaleY =
    typeof requestedScaleY === "number" &&
    Number.isFinite(requestedScaleY) &&
    requestedScaleY > 0
      ? requestedScaleY
      : scaleX;
  const viewportWidth =
    Number.isFinite(args.viewportWidth) && args.viewportWidth > 0
      ? args.viewportWidth
      : 1280;
  const viewportHeight =
    Number.isFinite(args.viewportHeight) && args.viewportHeight > 0
      ? args.viewportHeight
      : 900;
  const paintedWidth = viewportWidth * Math.max(1, scaleX);
  const paintedHeight = viewportHeight * Math.max(1, scaleY);
  if (
    paintedWidth > MAX_RETAINED_IFRAME_PAINT_AXIS_PX ||
    paintedHeight > MAX_RETAINED_IFRAME_PAINT_AXIS_PX
  ) {
    return { backfaceVisibility: "visible" };
  }
  return SCALED_IFRAME_PAINT_RETENTION_STYLE;
}
