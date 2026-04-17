/**
 * Helper for snapping the draggable camera bubble to the nearest corner
 * with a fixed gutter from the viewport edge.
 */

export type Corner = "tl" | "tr" | "bl" | "br";

export interface BubblePosition {
  left: number;
  top: number;
  corner: Corner;
}

/** Default gutter from viewport edges. */
export const GUTTER_PX = 16;

/**
 * Given a proposed absolute (left, top) for the top-left corner of the bubble,
 * plus its size and the viewport size, return the nearest corner-snapped
 * position keeping `GUTTER_PX` from every edge.
 */
export function snapToCorner(
  proposedLeft: number,
  proposedTop: number,
  bubbleSize: number,
  viewport: { width: number; height: number },
  gutter = GUTTER_PX,
): BubblePosition {
  const centerX = proposedLeft + bubbleSize / 2;
  const centerY = proposedTop + bubbleSize / 2;
  const isRight = centerX > viewport.width / 2;
  const isBottom = centerY > viewport.height / 2;

  const left = isRight ? viewport.width - bubbleSize - gutter : gutter;
  const top = isBottom ? viewport.height - bubbleSize - gutter : gutter;
  const corner: Corner = isBottom
    ? isRight
      ? "br"
      : "bl"
    : isRight
      ? "tr"
      : "tl";
  return { left, top, corner };
}

/** Default initial position — bottom-left. */
export function initialBubblePosition(
  bubbleSize: number,
  viewport: { width: number; height: number },
  gutter = GUTTER_PX,
): BubblePosition {
  return {
    left: gutter,
    top: Math.max(gutter, viewport.height - bubbleSize - gutter),
    corner: "bl",
  };
}

/**
 * Clamp a (left, top) to stay within viewport bounds with the given gutter.
 * Used during drag before we snap on release.
 */
export function clampToViewport(
  left: number,
  top: number,
  bubbleSize: number,
  viewport: { width: number; height: number },
  gutter = GUTTER_PX,
): { left: number; top: number } {
  return {
    left: Math.max(
      gutter,
      Math.min(viewport.width - bubbleSize - gutter, left),
    ),
    top: Math.max(gutter, Math.min(viewport.height - bubbleSize - gutter, top)),
  };
}
