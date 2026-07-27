export function parseNumericValue(value: string): number {
  return parseFloat(value) || 0;
}

export function sidesAreLinked(values: {
  top: string;
  right: string;
  bottom: string;
  left: string;
}) {
  return (
    parseNumericValue(values.top || "0") ===
      parseNumericValue(values.right || "0") &&
    parseNumericValue(values.top || "0") ===
      parseNumericValue(values.bottom || "0") &&
    parseNumericValue(values.top || "0") ===
      parseNumericValue(values.left || "0")
  );
}

export const ALIGN_SELF_OPTIONS = [
  { value: "auto", key: "auto" },
  { value: "flex-start", key: "start" },
  { value: "center", key: "center" },
  { value: "flex-end", key: "end" },
  { value: "stretch", key: "stretch" },
  { value: "baseline", key: "baseline" },
] as const;
// Inside is a real `border` (draws inset from the box edge by definition).
// Outside and center are both implemented as CSS `outline`, which always
// paints just outside the border-box edge — `outline-offset` then pushes it
// further out (outside, offset 0) or pulls it back by half its own width so
// it straddles the edge (center, offset -width/2). See readStrokeOutlinePosition
// for how a persisted outline is read back into one of these three options.
export const STROKE_POSITION_OPTIONS = [
  { value: "inside", key: "inside" },
  { value: "outside", key: "outside" },
  { value: "center", key: "center" },
] as const;
export const BLEND_MODE_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
  { value: "color-dodge", label: "Color dodge" }, // i18n-ignore design blend mode label
  { value: "color-burn", label: "Color burn" }, // i18n-ignore design blend mode label
  { value: "hard-light", label: "Hard light" }, // i18n-ignore design blend mode label
  { value: "soft-light", label: "Soft light" }, // i18n-ignore design blend mode label
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Color" },
  { value: "luminosity", label: "Luminosity" },
] as const;

/**
 * Resolve a CSS line-height value to a unitless ratio for display/editing.
 * When the browser returns a px-computed value (e.g. "19.2px" for line-height
 * 1.2 on a 16px font), divide by the font-size to recover the unitless ratio.
 * Falls back to 1.2 when the value cannot be parsed.
 */
export function resolveLineHeight(
  lineHeight: string | undefined,
  fontSize: string | undefined,
): number {
  const lh = lineHeight?.trim() || "";
  if (!lh || lh === "normal") return 1.2;
  if (lh.endsWith("px")) {
    const lhPx = parseFloat(lh);
    const fsPx = parseFloat(fontSize || "");
    if (Number.isFinite(lhPx) && Number.isFinite(fsPx) && fsPx > 0) {
      return Math.round((lhPx / fsPx) * 100) / 100;
    }
    // A px-computed line-height that we can't divide by a valid font-size
    // (missing/invalid fontSize) must NOT fall through to the unitless-ratio
    // parse below — `parseFloat("19.2px")` silently reads as `19.2`, which
    // would render as a wildly wrong multiplier (e.g. "19.2") instead of a
    // sane ~1.2 ratio. Fall back to the same default the empty/"normal" case
    // above uses.
    return 1.2;
  }
  const numeric = parseFloat(lh);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1.2;
}

export function optionValue<T extends readonly { value: string }[]>(
  options: T,
  value: string | undefined,
  fallback: T[number]["value"],
) {
  return options.some((option) => option.value === value) ? value! : fallback;
}
