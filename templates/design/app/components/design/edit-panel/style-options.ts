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
