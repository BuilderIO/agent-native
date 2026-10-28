import {
  displayP3ToLinearSrgb,
  formatDisplayP3Css,
  formatLinearAsDisplayP3Css,
  formatLinearAsOklchCss,
  gamutOf,
  hsvToRgb,
  linearSrgbToDisplayP3,
  linearSrgbToOklch,
  linearToRgbaGamutMapped,
  mapToGamut,
  parseWideColor,
  rgbaToLinearSrgb,
  rgbToHsv,
  type Hsv,
  type Oklch,
  type Vec3,
  type WideColor,
} from "@shared/color-spaces";
import {
  parseCssColor,
  rgbaToCss,
  rgbaToHex,
  withCssColorAlpha,
} from "@shared/color-utils";

import { HUE_TRACK_BACKGROUND } from "./color-picker-swatch";
import type { DesignColorMode } from "./color-picker-utils";

/**
 * The picker's color model, apart from React.
 *
 * A picker color is an UNCLAMPED linear-sRGB triple (see `@shared/color-spaces`)
 * plus alpha, so a color outside sRGB survives every edit. The MODE is the
 * notation: it picks the value cells, the hue strip, the square's primaries
 * and the CSS the picker writes. Hex, RGB, HSL and HSB write sRGB (hex, or
 * a translucent rgb color), mapping a wider color into sRGB first; Display P3
 * writes `color(display-p3 …)`; OKLCH writes `oklch()`.
 */

export type ColorNotation = "srgb" | "display-p3" | "oklch";

export function modeNotation(mode: DesignColorMode): ColorNotation {
  if (mode === "p3") return "display-p3";
  if (mode === "oklch") return "oklch";
  return "srgb";
}

/** The `oklch()` / `color(display-p3|srgb …)` reading of a color string, or null. */
export function readWideColor(css: string): WideColor | null {
  const parsed = parseWideColor(css);
  return parsed?.kind === "ok" ? parsed.color : null;
}

/**
 * The mode a color opens in: the notation it was authored in. An sRGB color
 * keeps the sRGB mode already chosen, and falls back to hex from a wide one.
 */
export function modeForValue(
  css: string,
  current: DesignColorMode,
): DesignColorMode {
  const wide = readWideColor(css);
  if (wide?.notation === "oklch") return "oklch";
  if (wide?.notation === "display-p3") return "p3";
  return modeNotation(current) === "srgb" ? current : "hex";
}

/** The CSS a mode writes for a color. A color wider than the mode is mapped into it. */
export function writeColor(
  mode: DesignColorMode,
  linear: Vec3,
  alpha: number,
  oklchHueHint = 0,
): string {
  switch (modeNotation(mode)) {
    case "display-p3":
      return formatLinearAsDisplayP3Css(linear, alpha);
    case "oklch":
      return formatLinearAsOklchCss(linear, alpha, oklchHueHint);
    case "srgb":
      return rgbaToCss(linearToRgbaGamutMapped(linear, alpha));
  }
}

/**
 * The color at a new alpha, written in the mode's notation. A color already in
 * that notation keeps its authored digits (a palette's `0.1234` stays
 * `0.1234`); any other is converted. null when the string is not a color the
 * editor can read.
 */
export function rewriteAlpha(
  mode: DesignColorMode,
  css: string,
  alpha: number,
  oklchHueHint = 0,
): string | null {
  const wide = readWideColor(css);
  const own: ColorNotation =
    wide && wide.notation !== "srgb" ? wide.notation : "srgb";
  if (own === modeNotation(mode)) return withCssColorAlpha(css, alpha);
  const parsed = wide ? null : parseCssColor(css);
  const linear = wide?.linear ?? (parsed ? rgbaToLinearSrgb(parsed) : null);
  return linear ? writeColor(mode, linear, alpha, oklchHueHint) : null;
}

export interface GamutFallbacks {
  /** The sRGB color a surface without wide color shows instead, as hex. */
  srgbHex: string;
  /** Set only when the color is past Display P3 too: what a P3 surface shows. */
  p3Css?: string;
}

/**
 * Where a color falls back to on narrower screens, or null when it already
 * fits in sRGB. These are the gamut-mapped results the picker writes in the
 * narrower modes, so the tooltip names exactly what the design would get.
 */
export function gamutFallbacks(linear: Vec3): GamutFallbacks | null {
  const gamut = gamutOf(linear);
  if (gamut === "srgb") return null;
  const srgbHex = rgbaToHex(linearToRgbaGamutMapped(linear, 1)).toUpperCase();
  if (gamut === "p3") return { srgbHex };
  return {
    srgbHex,
    p3Css: formatLinearAsOklchCss(mapToGamut(linear, "p3"), 1),
  };
}

// ── The square and hue strip in the wide modes ─────────────────────────────
// Display P3 and OKLCH put the square over Display P3's primaries, so it
// reaches colors sRGB cannot show.

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** The color's saturation/brightness in Display P3 (the color mapped into P3 first). */
export function wideSquareHsv(linear: Vec3, hueHint: number): Hsv {
  const [r, g, b] = linearSrgbToDisplayP3(mapToGamut(linear, "p3"));
  return rgbToHsv([clampUnit(r), clampUnit(g), clampUnit(b)], hueHint);
}

export function linearFromWideSquare(hsv: Hsv): Vec3 {
  return displayP3ToLinearSrgb(hsvToRgb(hsv));
}

/** The pure hue at full saturation and brightness in Display P3, as CSS. */
export function wideHueColor(hue: number): string {
  return formatDisplayP3Css(hsvToRgb({ h: hue, s: 1, v: 1 }), 1);
}

const HUE_STOPS = [0, 60, 120, 180, 240, 300, 360];

const P3_HUE_TRACK_BACKGROUND = `linear-gradient(90deg, ${HUE_STOPS.map((hue) => wideHueColor(hue)).join(", ")})`;

// The strip runs in OKLCH hue order, so the knob sits at the color's OKLCH hue.
const OKLCH_HUE_TRACK_BACKGROUND = `linear-gradient(90deg, ${HUE_STOPS.map((hue) => `oklch(75% 0.18 ${hue})`).join(", ")})`;

export function hueTrackBackground(mode: DesignColorMode): string {
  switch (modeNotation(mode)) {
    case "display-p3":
      return P3_HUE_TRACK_BACKGROUND;
    case "oklch":
      return OKLCH_HUE_TRACK_BACKGROUND;
    case "srgb":
      return HUE_TRACK_BACKGROUND;
  }
}

// ── Value cells for the wide modes ─────────────────────────────────────────

export interface ModeCell {
  key: string;
  /** Short letter shown in the field and used as its accessible name. */
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals: number;
}

const P3_LABELS = ["R", "G", "B"] as const;

export function p3Cells(p3: Vec3): ModeCell[] {
  return p3.map((value, index) => ({
    key: ["r", "g", "b"][index]!,
    label: P3_LABELS[index]!,
    value,
    min: 0,
    max: 1,
    step: 0.004,
    decimals: 3,
  }));
}

export function oklchCells(oklch: Oklch): ModeCell[] {
  return [
    {
      key: "l",
      label: "L",
      value: oklch.l * 100,
      min: 0,
      max: 100,
      step: 0.5,
      decimals: 1,
    },
    {
      key: "c",
      label: "C",
      value: oklch.c,
      min: 0,
      max: 0.5,
      step: 0.002,
      decimals: 3,
    },
    {
      key: "h",
      label: "H",
      value: oklch.h,
      min: 0,
      max: 360,
      step: 1,
      decimals: 1,
    },
  ];
}

/** Display P3 channels for a color: as authored when it was, else the color mapped into P3. */
export function displayP3Of(linear: Vec3, authored: WideColor | null): Vec3 {
  if (authored?.notation === "display-p3") return authored.p3;
  const [r, g, b] = linearSrgbToDisplayP3(mapToGamut(linear, "p3"));
  return [clampUnit(r), clampUnit(g), clampUnit(b)];
}

/** OKLCH numbers for a color: as authored when it was, else read from the color. */
export function oklchOf(
  linear: Vec3,
  authored: WideColor | null,
  hueHint: number,
): Oklch {
  if (authored?.notation === "oklch") return authored.oklch;
  return linearSrgbToOklch(linear, hueHint);
}

/** The color with one OKLCH cell changed; the others stay exactly as they were. */
export function withOklchCell(oklch: Oklch, key: string, value: number): Oklch {
  if (key === "l") return { ...oklch, l: value / 100 };
  if (key === "c") return { ...oklch, c: value };
  return { ...oklch, h: value };
}

export function withP3Cell(p3: Vec3, index: number, value: number): Vec3 {
  const next: Vec3 = [p3[0], p3[1], p3[2]];
  next[index] = value;
  return next;
}
