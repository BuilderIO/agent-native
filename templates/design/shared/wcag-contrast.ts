import {
  linearSrgbToOklch,
  linearToRgbaGamutMapped,
  mapToGamut,
  OKLCH_ACHROMATIC_CHROMA,
  oklchToLinearSrgb,
  srgbToLinear,
  type Vec3,
} from "./color-spaces";

/**
 * WCAG 2.2 text contrast (success criteria 1.4.3 and 1.4.6): relative
 * luminance, contrast ratio, the large-text rule, and a solver that moves a
 * color's OKLCH lightness until a target ratio is met.
 *
 * Colors are measured as what an sRGB screen shows. A color outside sRGB is
 * gamut-mapped first (`linearToRgbaGamutMapped`), so a wide color is judged by
 * its sRGB fallback and never by a clipped stand-in.
 */

/** An opaque sRGB color, channels 0..255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  a: number;
}

/** WCAG relative luminance of an opaque sRGB color: 0 is black, 1 is white. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * srgbToLinear(r / 255) +
    0.7152 * srgbToLinear(g / 255) +
    0.0722 * srgbToLinear(b / 255)
  );
}

/** The ratio of two opaque colors, from 1 (identical) to 21 (black on white). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * A translucent color painted over an opaque one, blended per channel in
 * sRGB as browsers do. Not rounded, so a ratio is not nudged by 8-bit steps.
 */
export function compositeOver(foreground: Rgba, background: Rgb): Rgb {
  const alpha = Math.min(1, Math.max(0, foreground.a));
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
  };
}

/** 24px and up, or 18.66px (14pt) and up when bold: WCAG's "large text". */
export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
}

export interface ContrastTargets {
  /** Level AA: 4.5, or 3 for large text. */
  aa: number;
  /** Level AAA: 7, or 4.5 for large text. */
  aaa: number;
}

export function contrastTargets(large: boolean): ContrastTargets {
  return large ? { aa: 3, aaa: 4.5 } : { aa: 4.5, aaa: 7 };
}

export type ContrastLevel = "AAA" | "AA" | null;

/** The highest level a ratio reaches; null when it misses AA. */
export function contrastLevel(
  ratio: number,
  targets: ContrastTargets,
): ContrastLevel {
  if (ratio >= targets.aaa) return "AAA";
  if (ratio >= targets.aa) return "AA";
  return null;
}

/**
 * The ratio as shown: cut, never rounded, to two decimals, so 4.4999 reads
 * 4.49 and a color that misses a level never displays as having met it.
 */
export function formatContrastRatio(ratio: number): string {
  return (Math.floor(ratio * 100 + 1e-9) / 100).toFixed(2);
}

/**
 * The ratio of a text color against what is behind it. `linear` may be
 * outside sRGB; `alpha` blends it over `background` first.
 */
export function textContrastRatio(
  linear: Vec3,
  alpha: number,
  background: Rgb,
): number {
  const text = linearToRgbaGamutMapped(linear, alpha);
  return contrastRatio(compositeOver(text, background), background);
}

export type ContrastFix =
  | { kind: "fixed"; linear: Vec3 }
  /** No lightness at this hue and chroma, and this opacity, reaches the target. */
  | { kind: "unreachable" };

const SEARCH_STEPS = 24;
const NUDGE = 0.0005;
const MAX_NUDGES = 200;

/** `#RRGGBB`, each channel rounded: a composited background has fractions. */
export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b]
    .map((channel) =>
      Math.min(255, Math.max(0, Math.round(channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

/**
 * Moves the color's OKLCH lightness, keeping hue and chroma, to the passing
 * lightness nearest the current one. The color stays inside sRGB, and opacity
 * is never changed. `settle` maps a candidate to the color as it reads back
 * once written (an 8-bit hex, say), or null when it cannot be written; a fix
 * is checked on the value the design would actually hold, and is stepped on
 * until that value passes. A candidate that cannot be written never passes.
 */
export function fixContrast({
  linear,
  alpha,
  background,
  target,
  hueHint = 0,
  settle = (candidate) => candidate,
}: {
  linear: Vec3;
  alpha: number;
  background: Rgb;
  target: number;
  hueHint?: number;
  settle?: (candidate: Vec3) => Vec3 | null;
}): ContrastFix {
  const origin = linearSrgbToOklch(linear, hueHint);
  // A gray's chroma is conversion noise, and the solver lands exactly where a
  // channel rounds over, so noise would tint the result: keep a gray exact.
  const achromatic = origin.c < OKLCH_ACHROMATIC_CHROMA;
  const at = (lightness: number): Vec3 | null => {
    const candidate = oklchToLinearSrgb({
      l: lightness,
      c: achromatic ? 0 : origin.c,
      h: origin.h,
    });
    const level = (candidate[0] + candidate[1] + candidate[2]) / 3;
    return settle(
      mapToGamut(achromatic ? [level, level, level] : candidate, "srgb"),
    );
  };
  const passes = (lightness: number): boolean => {
    const candidate = at(lightness);
    return (
      candidate !== null &&
      textContrastRatio(candidate, alpha, background) >= target
    );
  };
  const fixedAt = (lightness: number): ContrastFix => {
    const candidate = at(lightness);
    return candidate
      ? { kind: "fixed", linear: candidate }
      : { kind: "unreachable" };
  };

  const darkest = passes(0);
  const lightest = passes(1);
  if (!darkest && !lightest) return { kind: "unreachable" };

  // Contrast changes one way with lightness on each side of the background's
  // own, so each side is one bisection toward the lightness that just passes.
  let darker: number | null = null;
  if (darkest) {
    let passing = 0;
    let failing = origin.l;
    if (passes(failing)) return fixedAt(failing);
    for (let step = 0; step < SEARCH_STEPS; step += 1) {
      const middle = (passing + failing) / 2;
      if (passes(middle)) passing = middle;
      else failing = middle;
    }
    darker = passing;
  }
  let lighter: number | null = null;
  if (lightest) {
    let failing = origin.l;
    let passing = 1;
    if (passes(failing)) return fixedAt(failing);
    for (let step = 0; step < SEARCH_STEPS; step += 1) {
      const middle = (failing + passing) / 2;
      if (passes(middle)) passing = middle;
      else failing = middle;
    }
    lighter = passing;
  }

  const choices = [darker, lighter].filter(
    (lightness): lightness is number => lightness !== null,
  );
  const lightness = choices.reduce((nearest, candidate) =>
    Math.abs(candidate - origin.l) < Math.abs(nearest - origin.l)
      ? candidate
      : nearest,
  );

  // Writing rounds the color; step away from the failing side until the
  // written value itself passes.
  const away = lightness === darker ? -1 : 1;
  let settled = lightness;
  for (let nudge = 0; nudge < MAX_NUDGES && !passes(settled); nudge += 1) {
    settled = Math.min(1, Math.max(0, settled + away * NUDGE));
  }
  return passes(settled) ? fixedAt(settled) : { kind: "unreachable" };
}
