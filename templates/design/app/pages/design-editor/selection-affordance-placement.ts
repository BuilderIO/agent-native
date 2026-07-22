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

/**
 * Place a small floating affordance (chip/button of `affordanceSize`) just
 * outside a selection rect, defaulting to the selection's upper-right OUTER
 * corner and flipping/clamping so the whole box stays inside `viewport`. Pure:
 * no DOM, no timers.
 *
 * Order of decisions:
 *   1. Try upper-right: left = anchor.right + gap, top = anchor.top.
 *   2. If that overflows the right edge, flip to the left of the selection:
 *      left = anchor.left - gap - width; horizontal corner becomes "left".
 *   3. Clamp top into [0, viewport.height - height]. If the clamp pushed the
 *      box below the anchor's top, the vertical corner becomes "bottom".
 *   4. Last resort: clamp left into [0, viewport.width - width] so the box is
 *      always fully inside the viewport. `corner` reflects the side of the
 *      selection the box ended up on.
 */
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
