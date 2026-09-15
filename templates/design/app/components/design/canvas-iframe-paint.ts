import type { CSSProperties } from "react";

/**
 * Every canvas iframe is painted through an ancestor `transform: scale()` —
 * the overview world layer, the breakpoint sub-frame fit, or single-screen
 * zoom. Below roughly 1:2 Chromium stops keeping the child browsing context's
 * composited backing store alive and the frame paints as a flat white or
 * solid black rectangle, while its document stays fully loaded and
 * inspectable. That reads as "generation produced a blank page", which is the
 * failure users actually report; the content is fine and reappears the moment
 * the effective scale rises.
 *
 * `backface-visibility: hidden` promotes the iframe to its own composited
 * layer, which keeps the backing store resident at fractional scale. It is
 * deliberately transform-free so a site that already sets its own
 * `transform: scale()` can spread this without clobbering it.
 *
 * Spread this into every canvas iframe rather than copying the declaration.
 * It was previously inlined at two of the three render sites, and the one that
 * was missed — DesignCanvas, the only one the real editor renders — is why the
 * bug stayed live after it was diagnosed and "fixed".
 * `canvas-iframe-paint.test.ts` fails when a new site inlines it instead.
 */
export const CANVAS_IFRAME_PAINT_RETENTION_STYLE = {
  backfaceVisibility: "hidden",
} satisfies CSSProperties;
