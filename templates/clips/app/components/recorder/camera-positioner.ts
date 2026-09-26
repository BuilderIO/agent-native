export type Corner = "tl" | "tr" | "bl" | "br";

export interface BubblePosition {
  left: number;
  top: number;
  corner: Corner;
}

export const GUTTER_PX = 16;

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

export function clampToViewport(
  left: number,
  top: number,
  bubbleSize: number,
  viewport: { width: number; height: number },
  gutter = GUTTER_PX,
): { left: number; top: number } {
  return clampRectToViewport(
    left,
    top,
    { width: bubbleSize, height: bubbleSize },
    viewport,
    gutter,
  );
}

export function clampRectToViewport(
  left: number,
  top: number,
  rect: { width: number; height: number },
  viewport: { width: number; height: number },
  gutter = GUTTER_PX,
): { left: number; top: number } {
  return {
    left: Math.max(
      gutter,
      Math.min(viewport.width - rect.width - gutter, left),
    ),
    top: Math.max(
      gutter,
      Math.min(viewport.height - rect.height - gutter, top),
    ),
  };
}
