import type { CSSProperties } from "react";

/**
 * Several surfaces paint a live iframe through an ancestor `transform:
 * scale()` well below 1:1 — overview screens under the canvas world layer,
 * breakpoint sub-frames, the low-zoom board preview, design thumbnails, and
 * template cards. Past roughly 1:2 Chromium stops keeping the child browsing
 * context's composited backing store alive and the frame paints as a flat
 * white or solid black rectangle, while its document stays fully loaded and
 * inspectable. That reads as "generation produced a blank page", which is the
 * failure users actually report; the content is fine and reappears the moment
 * the effective scale rises.
 *
 * `backface-visibility: hidden` promotes the iframe to its own composited
 * layer, which keeps the backing store resident at fractional scale. It is
 * deliberately transform-free so a site that already sets its own
 * `transform: scale()` can spread this without clobbering it.
 *
 * Spread this into every shrunken iframe rather than copying the declaration.
 * It was previously inlined at two render sites and missed at the ones that
 * mattered — including DesignCanvas, the only path the real editor renders —
 * which is why the bug stayed live after it was diagnosed and "fixed".
 * `scaled-iframe-paint.test.tsx` fails when a new site inlines or omits it.
 */
export const SCALED_IFRAME_PAINT_RETENTION_STYLE = {
  backfaceVisibility: "hidden",
} satisfies CSSProperties;

/** Keep large documents in Chromium's tiled paint path instead of one GPU surface. */
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
  if (
    viewportWidth * scaleX > MAX_RETAINED_IFRAME_PAINT_AXIS_PX ||
    viewportHeight * scaleY > MAX_RETAINED_IFRAME_PAINT_AXIS_PX
  ) {
    return { backfaceVisibility: "visible" };
  }
  return SCALED_IFRAME_PAINT_RETENTION_STYLE;
}
