import { relativePositionContainingBlockDirection } from "@shared/relative-position-containing-block";

import type { RelativePositionOffset } from "@/lib/design-import";

type PositionStyle = Pick<
  CSSStyleDeclaration,
  | "position"
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "zIndex"
  | "display"
  | "direction"
>;

export function readRelativePositionStyles<
  T extends { parentElement: T | null },
>(
  element: T,
  getComputedStyle: (element: T) => PositionStyle,
): {
  computedStyles: Pick<
    Record<string, string>,
    "position" | "left" | "right" | "top" | "bottom" | "zIndex"
  >;
  relativeContainingBlockDirection?: "ltr" | "rtl";
} {
  const computed = getComputedStyle(element);
  const direction =
    computed.position === "relative"
      ? relativePositionContainingBlockDirection(element, getComputedStyle)
      : undefined;
  return {
    computedStyles: {
      position: computed.position,
      left: computed.left,
      right: computed.right,
      top: computed.top,
      bottom: computed.bottom,
      zIndex: computed.zIndex,
    },
    ...(computed.position === "relative"
      ? { relativeContainingBlockDirection: direction }
      : {}),
  };
}

type RelativeInsetValues = {
  left?: string;
  right?: string;
  top?: string;
  bottom?: string;
};

type ParsedInset = { kind: "auto" } | { kind: "value"; value: number } | null;

function parsePixelInset(value: string | undefined): ParsedInset {
  if (value === undefined) return { kind: "auto" };
  const normalized = value.trim().toLowerCase();
  if (normalized === "auto" || normalized === "") {
    return { kind: "auto" };
  }
  const match = normalized.match(/^([+-]?(?:\d+\.?\d*|\.\d+))(px)?$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!match[2] && parsed !== 0) return null;
  return Number.isFinite(parsed) ? { kind: "value", value: parsed } : null;
}

function resolveAxis(
  startInset: string | undefined,
  endInset: string | undefined,
  startSign: 1 | -1,
  endSign: 1 | -1,
  direction?: string,
): number | null {
  const start = parsePixelInset(startInset);
  const end = parsePixelInset(endInset);
  if (!start || !end) return null;
  if (start.kind === "value" && end.kind === "value") {
    if (direction !== "ltr" && direction !== "rtl") return null;
    const useEnd = startSign === 1 && direction === "rtl";
    return useEnd ? end.value * endSign : start.value * startSign;
  }
  if (start.kind === "value") return start.value * startSign;
  if (end.kind === "value") return end.value * endSign;
  return 0;
}

export function effectiveRelativePositionOffset(
  insets: RelativeInsetValues,
  parentDirection?: string,
): RelativePositionOffset | null {
  const x = resolveAxis(insets.left, insets.right, 1, -1, parentDirection);
  const y = resolveAxis(insets.top, insets.bottom, 1, -1, "ltr");
  if (x === null || y === null) return null;
  return { x, y };
}
