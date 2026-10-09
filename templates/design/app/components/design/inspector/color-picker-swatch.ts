import {
  isWideGamutNotation,
  parseCssColor,
  parseCssColorExtended,
  rgbaToCss,
  type RgbaColor,
} from "@shared/color-utils";
import type { CSSProperties } from "react";

// Keep transparency tiles light on both light and dark editor surfaces.
// guard:allow-raw-color — fixed light checkerboard tile keeps transparency visible.
export const CHECKER_A = "#e5e5e5";
// guard:allow-raw-color — fixed light checkerboard tile keeps transparency visible.
export const CHECKER_B = "#ffffff";
export const CHECKERBOARD_IMAGE = `conic-gradient(${CHECKER_A} 25%, ${CHECKER_B} 0 50%, ${CHECKER_A} 0 75%, ${CHECKER_B} 0)`;

// guard:allow-raw-color — the hue strip shows the hue wheel's fixed primaries.
export const HUE_TRACK_BACKGROUND = `linear-gradient(90deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)`;

/**
 * A swatch for a color that cannot be shown (a token that is not defined, or
 * not loaded): diagonal hatching, never a stand-in color.
 */
export const UNRESOLVED_SWATCH_CLASS =
  "bg-[repeating-linear-gradient(135deg,transparent_0_3px,hsl(var(--foreground)/0.25)_3px_4px)]";

export type SwatchStyle = Pick<
  CSSProperties,
  | "backgroundColor"
  | "backgroundImage"
  | "backgroundSize"
  | "backgroundPosition"
>;

export function toCssColor(color: RgbaColor): string {
  return rgbaToCss(color);
}

export function looksLikeImageOrGradient(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return lower.includes("gradient(") || lower.startsWith("url(");
}

export function swatchStyle(value: string): SwatchStyle {
  // A wide-gamut color is drawn as written, so a Display P3 screen shows it.
  if (isWideGamutNotation(value)) {
    const alpha = parseCssColor(value)?.a ?? 1;
    if (alpha < 1) {
      return {
        backgroundImage: `linear-gradient(${value}, ${value}), ${CHECKERBOARD_IMAGE}`,
        backgroundColor: CHECKER_B,
        backgroundSize: "100% 100%, 8px 8px",
        backgroundPosition: "0 0, 0 0",
      };
    }
    return { backgroundColor: value };
  }
  const parsed = parseCssColorExtended(value);
  if (parsed && parsed.a < 1) {
    return {
      backgroundImage: `linear-gradient(${rgbaToCss(parsed)}, ${rgbaToCss(parsed)}), ${CHECKERBOARD_IMAGE}`,
      backgroundColor: CHECKER_B,
      backgroundSize: "100% 100%, 8px 8px",
      backgroundPosition: "0 0, 0 0",
    };
  }
  if (parsed) return { backgroundColor: rgbaToCss(parsed) };
  if (value && looksLikeImageOrGradient(value)) {
    return { backgroundImage: value };
  }
  return {
    backgroundImage: CHECKERBOARD_IMAGE,
    backgroundColor: CHECKER_B,
    backgroundSize: "8px 8px",
  };
}

export function triggerSwatchStyle(
  value: string,
  color: RgbaColor,
): SwatchStyle {
  const lower = value.trim().toLowerCase();
  if (!lower || lower === "transparent") {
    return {
      backgroundImage: CHECKERBOARD_IMAGE,
      backgroundColor: CHECKER_B,
      backgroundSize: "8px 8px",
    };
  }
  if (
    lower.includes("gradient(") ||
    lower.startsWith("url(") ||
    isWideGamutNotation(value)
  ) {
    return swatchStyle(value);
  }
  return swatchStyle(rgbaToCss(color));
}

export function alphaTrackBackground(color: RgbaColor): string {
  // guard:allow-raw-color — dynamic alpha gradient must use the selected RGB values.
  return `linear-gradient(90deg, rgba(${color.r}, ${color.g}, ${color.b}, 0), rgba(${color.r}, ${color.g}, ${color.b}, 1)), ${CHECKERBOARD_IMAGE}`;
}

/** The alpha track for a wide-gamut color, drawn in its own notation. */
export function alphaTrackBackgroundFor(
  transparent: string,
  opaque: string,
): string {
  return `linear-gradient(90deg, ${transparent}, ${opaque}), ${CHECKERBOARD_IMAGE}`;
}
