/**
 * Converts a viewport point into the iframe's unscaled content coordinates.
 *
 * `scrollOffset` is the embedded screen's own internal document scroll
 * (`iframe.contentWindow.scrollX/scrollY`), already expressed in the iframe's
 * own unscaled content pixels — the SAME units as `iframeContentSize` and the
 * function's return value. It is folded in AFTER the scale division, never
 * multiplied/divided by `scaleX`/`scaleY`: the outer `scaleX`/`scaleY` factor
 * only undoes the *host* canvas's zoom transform (which maps `iframeRect`,
 * a host-viewport rect, onto `iframeContentSize`, the iframe's own layout
 * box) and has nothing to do with how far the iframe's own document has been
 * scrolled internally. Concretely: at 50% host zoom (scaleX = 0.5) with the
 * embedded screen scrolled 600px down, a click at the iframe's visible top
 * edge (rendered content y = 0) must land at content y = 600 — not 1200 (a
 * mistaken `600 / 0.5`) and not 300 (a mistaken `600 * 0.5`).
 */
export function getScreenContentPointFromClient(
  clientX: number,
  clientY: number,
  iframeRect: { left: number; top: number; width: number; height: number },
  iframeContentSize: { width: number; height: number },
  scrollOffset: { left: number; top: number } = { left: 0, top: 0 },
): { x: number; y: number } {
  const scaleX =
    iframeContentSize.width > 0
      ? iframeRect.width / iframeContentSize.width
      : 1;
  const scaleY =
    iframeContentSize.height > 0
      ? iframeRect.height / iframeContentSize.height
      : 1;
  return {
    x: (clientX - iframeRect.left) / (scaleX || 1) + scrollOffset.left,
    y: (clientY - iframeRect.top) / (scaleY || 1) + scrollOffset.top,
  };
}

/**
 * Computes the scroll delta needed to keep a viewport point anchored while
 * zooming a top-left-origin canvas layer.
 */
export function getZoomToCursorScrollDelta(
  anchorClient: { x: number; y: number },
  containerRect: { left: number; top: number },
  scrollOffset: { scrollLeft: number; scrollTop: number },
  zoomRatio: number,
): { dx: number; dy: number } {
  const cx = anchorClient.x - containerRect.left + scrollOffset.scrollLeft;
  const cy = anchorClient.y - containerRect.top + scrollOffset.scrollTop;
  return {
    dx: cx * (zoomRatio - 1),
    dy: cy * (zoomRatio - 1),
  };
}
