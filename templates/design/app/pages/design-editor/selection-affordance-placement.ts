export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface AffordancePlacement {
  left: number;
  top: number;
  corner: "top-right" | "top-left" | "bottom-right" | "bottom-left";
}

const DEFAULT_GAP = 8;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

/** Place a small floating affordance just outside a selection rect, defaulting
 * to the upper-right outer corner and flipping/clamping so the whole box stays
 * inside `viewport`. `corner` reflects which side it ended up on. Pure. */
export function placeAffordance(
  anchorRect: Rect,
  viewport: { width: number; height: number },
  affordanceSize: { width: number; height: number },
  gap: number = DEFAULT_GAP,
): AffordancePlacement {
  const maxLeft = viewport.width - affordanceSize.width;
  const maxTop = viewport.height - affordanceSize.height;

  let horizontal: "right" | "left" = "right";
  let rawLeft = anchorRect.right + gap;
  if (rawLeft + affordanceSize.width > viewport.width) {
    horizontal = "left";
    rawLeft = anchorRect.left - gap - affordanceSize.width;
  }

  const rawTop = anchorRect.top;
  const top = clamp(rawTop, 0, maxTop);
  const vertical: "top" | "bottom" = top > anchorRect.top ? "bottom" : "top";

  const left = clamp(rawLeft, 0, maxLeft);

  return { left, top, corner: `${vertical}-${horizontal}` };
}
