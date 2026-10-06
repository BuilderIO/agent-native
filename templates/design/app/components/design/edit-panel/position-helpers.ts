import {
  parseCssColor,
  parseCssColorExtended,
  rgbaToCss,
  withColorOpacity,
} from "@shared/color-utils";

export function cssLengthNumber(
  value: string | undefined,
  fallback = 0,
): number {
  const parsed = parseFloat(value || "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export function cssColorOrFallback(
  value: string | undefined,
  fallback: string,
) {
  const normalized = value?.trim();
  if (
    !normalized ||
    normalized === "none" ||
    normalized === "transparent" ||
    normalized === "rgba(0, 0, 0, 0)"
  ) {
    return fallback;
  }
  return normalized;
}

export function strokeIsVisible(
  width: string | undefined,
  style: string | undefined,
) {
  if (cssLengthNumber(width) <= 0) return false;
  return (style ?? "")
    .trim()
    .split(/\s+/)
    .some((side) => side !== "" && side !== "none" && side !== "hidden");
}

export function strokeHiddenByColor(color: string | undefined): boolean {
  return Boolean(color) && !colorHasVisibleAlpha(color);
}

export function vectorStrokeExists(stroke: string | undefined): boolean {
  const value = stroke?.trim();
  return Boolean(value && value !== "none");
}

export function vectorStrokeIsVisible(
  stroke: string | undefined,
  width: string | undefined,
): boolean {
  return (
    vectorStrokeExists(stroke) &&
    cssLengthNumber(width) > 0 &&
    colorHasVisibleAlpha(stroke)
  );
}

export function textStrokeIsVisible(
  width: string | undefined,
  color: string | undefined,
): boolean {
  return cssLengthNumber(width) > 0 && colorHasVisibleAlpha(color);
}

export function resolveTextStrokeColor(
  strokeColor: string | undefined,
): string {
  return cssColorOrFallback(strokeColor, "#000000");
}

export function textStrokeAddPatch(
  strokeColor: string | undefined,
): Record<string, string> {
  return {
    "-webkit-text-stroke-width": "1px",
    "-webkit-text-stroke-color": resolveTextStrokeColor(strokeColor),
  };
}

export function readTextStrokeStyle(styles: Record<string, string>): {
  width: string;
  color: string;
} {
  const longhandWidth = styles.webkitTextStrokeWidth;
  const longhandColor = styles.webkitTextStrokeColor;
  if (longhandWidth || longhandColor) {
    return { width: longhandWidth || "0px", color: longhandColor || "" };
  }
  const shorthand =
    styles["-webkit-text-stroke"] ??
    styles.WebkitTextStroke ??
    styles.webkitTextStroke;
  if (!shorthand) return { width: "0px", color: "" };
  return parseTextStrokeShorthand(shorthand);
}

/**
 * Splits a `-webkit-text-stroke` shorthand value ("<width> <color>", either
 * order per spec, browsers serialize width-then-color) into its two parts.
 * Cannot naively split on whitespace — `rgb(0, 0, 0)` / `rgba(...)` contain
 * internal commas but no spaces in the browser-serialized form, so a plain
 * "first token vs rest" split is safe for computed-style input; this is not
 * meant to validate arbitrary hand-authored shorthand values.
 */
function parseTextStrokeShorthand(shorthand: string): {
  width: string;
  color: string;
} {
  const trimmed = shorthand.trim();
  const match = /^(-?[\d.]+(?:px|em|rem|%))\s+(.+)$/.exec(trimmed);
  if (match) return { width: match[1]!, color: match[2]!.trim() };
  const reverseMatch = /^(.+?)\s+(-?[\d.]+(?:px|em|rem|%))$/.exec(trimmed);
  if (reverseMatch)
    return { width: reverseMatch[2]!, color: reverseMatch[1]!.trim() };
  return { width: "0px", color: "" };
}

export function readStrokeOutlinePosition(
  width: string | undefined,
  offset: string | undefined,
): "outside" | "center" {
  const widthPx = cssLengthNumber(width);
  const offsetPx = cssLengthNumber(offset);
  const centerOffset = -widthPx / 2;
  return Math.abs(offsetPx - centerOffset) < 0.5 && offsetPx < 0
    ? "center"
    : "outside";
}

export function outlineOffsetForPosition(
  position: "outside" | "center",
  width: string | undefined,
): string {
  if (position === "outside") return "0px";
  const widthPx = cssLengthNumber(width);
  return `${roundToOneDecimal(-widthPx / 2)}px`;
}

export function resolveRestoredStrokeStyle(
  styleValue: string | undefined,
): string {
  return styleValue === "none" ? "solid" : styleValue || "solid";
}

export function strokeShowPatch(
  prefix: "border" | "outline",
  color: string,
  width: string,
  styleValue: string,
): Record<string, string> {
  const parsed = parseCssColor(color);
  const restoredColor = parsed
    ? rgbaToCss(withColorOpacity(parsed, 100))
    : "#000000";
  const patch: Record<string, string> = {
    [`${prefix}Color`]: restoredColor,
    [`${prefix}Width`]: width === "0px" ? "1px" : width || "1px",
  };
  if (styleValue === "none") patch[`${prefix}Style`] = "solid";
  return patch;
}

export function swatchStyle(value: string | undefined) {
  return {
    background:
      value && value !== "none"
        ? value
        : "linear-gradient(135deg, hsl(var(--muted)) 0 45%, hsl(var(--border)) 45% 55%, hsl(var(--muted)) 55% 100%)",
  };
}

export function compactCssValue(value: string | undefined, fallback: string) {
  const normalized = value?.trim();
  if (!normalized || normalized === "none") return fallback;
  return normalized;
}

export function colorHasVisibleAlpha(value: string | undefined): boolean {
  const parsed = parseCssColorExtended(value || "");
  if (!parsed) {
    return Boolean(value && value !== "transparent" && value !== "none");
  }
  return parsed.a > 0;
}

export function fourValuesEqual(
  values: readonly [number, number, number, number],
): boolean {
  const [a, b, c, d] = values;
  return a === b && a === c && a === d;
}
