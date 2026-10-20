import {
  parseComputedBoxShadow,
  splitTopLevelCommas,
} from "./css-box-shadow.js";

export interface NativeCssPaintOutsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface NativeComputedPaintStyles {
  boxShadow: string | null | undefined;
  outlineStyle: string | null | undefined;
  outlineWidth: string | null | undefined;
  outlineOffset: string | null | undefined;
}

export type NativeCssPaintOutsetResult =
  | { kind: "ok"; outsets: NativeCssPaintOutsets }
  | {
      kind: "unreadable";
      property: keyof NativeComputedPaintStyles;
    };

export type NativeCssPaintOutsetLayer = "all" | "outer-shadow" | "outline";

const PX_LENGTH = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))px$/;
const COMPUTED_COLOR_FUNCTION =
  /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i;
const COMPUTED_COLOR_LITERAL = /^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+)(?=\s|$)/;
const OUTLINE_STYLES = new Set([
  "none",
  "hidden",
  "auto",
  "dotted",
  "dashed",
  "solid",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
]);

function computedColorEnd(value: string): number | null {
  const functional = value.match(COMPUTED_COLOR_FUNCTION);
  if (!functional)
    return value.match(COMPUTED_COLOR_LITERAL)?.[0].length ?? null;
  let depth = 0;
  for (let index = functional[0].length - 1; index < value.length; index++) {
    if (value[index] === "(") depth++;
    if (value[index] === ")") depth--;
    if (depth === 0) {
      const next = value[index + 1];
      return next === undefined || /\s/.test(next) ? index + 1 : null;
    }
  }
  return null;
}

function computedPx(value: string | null | undefined): number | null {
  const match = value?.trim().match(PX_LENGTH);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

function validComputedShadow(part: string): boolean {
  const rest = part.replace(/\binset\b/g, "").trim();
  const colorEnd = computedColorEnd(rest);
  if (colorEnd === null) return false;
  const lengths = rest.slice(colorEnd).trim().split(/\s+/);
  return (
    lengths.length >= 2 &&
    lengths.length <= 4 &&
    lengths.every((length) => computedPx(length) !== null) &&
    (lengths[2] === undefined || computedPx(lengths[2])! >= 0)
  );
}

export function readNativeCssPaintOutsets(
  style: NativeComputedPaintStyles,
  layer: NativeCssPaintOutsetLayer = "all",
): NativeCssPaintOutsetResult {
  const outsets: NativeCssPaintOutsets = {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const boxShadow = style.boxShadow?.trim();
  if (!boxShadow) return { kind: "unreadable", property: "boxShadow" };
  if (boxShadow !== "none") {
    const parts = splitTopLevelCommas(boxShadow);
    if (
      parts.length === 0 ||
      parts.some((part) => !validComputedShadow(part))
    ) {
      return { kind: "unreadable", property: "boxShadow" };
    }
    for (const shadow of parseComputedBoxShadow(boxShadow)) {
      if (shadow.inset) continue;
      if (layer === "outline") continue;
      const bleed = shadow.blur * 1.5 + Math.abs(shadow.spread) + 2;
      outsets.left = Math.max(outsets.left, bleed - shadow.offsetX);
      outsets.right = Math.max(outsets.right, bleed + shadow.offsetX);
      outsets.top = Math.max(outsets.top, bleed - shadow.offsetY);
      outsets.bottom = Math.max(outsets.bottom, bleed + shadow.offsetY);
    }
  }

  const outlineStyle = style.outlineStyle?.trim();
  if (!outlineStyle || !OUTLINE_STYLES.has(outlineStyle)) {
    return { kind: "unreadable", property: "outlineStyle" };
  }
  if (outlineStyle !== "none" && outlineStyle !== "hidden") {
    const width = computedPx(style.outlineWidth);
    if (width === null || width < 0) {
      return { kind: "unreadable", property: "outlineWidth" };
    }
    const offset = computedPx(style.outlineOffset);
    if (offset === null) {
      return { kind: "unreadable", property: "outlineOffset" };
    }
    const outside = layer === "outer-shadow" ? 0 : Math.max(0, width + offset);
    outsets.top = Math.max(outsets.top, outside);
    outsets.right = Math.max(outsets.right, outside);
    outsets.bottom = Math.max(outsets.bottom, outside);
    outsets.left = Math.max(outsets.left, outside);
  }
  return { kind: "ok", outsets };
}
