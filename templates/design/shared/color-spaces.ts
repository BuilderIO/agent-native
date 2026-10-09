/**
 * Color-space math for the Design color picker: sRGB, Display P3, HSB/HSL and
 * OKLab/OKLCH, plus CSS Color 4 gamut mapping.
 *
 * One rule runs through the file: colors are carried as UNCLAMPED linear-light
 * sRGB triples (`Vec3`). A component below 0 or above 1 is a real color that
 * sRGB cannot show (a saturated Display P3 green, an OKLCH chroma of 0.35), so
 * no conversion clamps. Narrowing to a gamut is always an explicit call:
 * `mapToGamut` (CSS Color 4 chroma reduction, keeps lightness and hue) or
 * `clipToGamut` (per-channel clamp). Nothing here turns an out-of-gamut color
 * into an in-gamut one on its own, and nothing returns a plausible color for
 * input it cannot read: parsers return `invalid` or `unsupported`.
 *
 * Sources: the sRGB/Display P3 matrices and transfer function are the CSS Color
 * Module Level 4 sample-code constants; OKLab is Björn Ottosson's
 * (bottosson.github.io/posts/oklab); the gamut mapping follows the CSS Color 4
 * "CSS Gamut Mapping Algorithm" (OKLCH chroma search, ΔEOK just-noticeable
 * difference 0.02).
 */

import type { RgbaColor } from "./color-utils";

export type Vec3 = [number, number, number];
export type Gamut = "srgb" | "p3";
export type ColorMode = "hex" | "rgb" | "hsl" | "hsb" | "p3" | "oklch";

export interface Oklch {
  /** Lightness, 0 (black) to 1 (white). */
  l: number;
  /** Chroma, 0 (gray) to about 0.4. */
  c: number;
  /** Hue in degrees, 0 to 360. Meaningless when chroma is under OKLCH_ACHROMATIC_CHROMA. */
  h: number;
}

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

// ── Matrices (CSS Color 4 sample code) ─────────────────────────────────────

type Matrix3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

const LIN_SRGB_TO_XYZ: Matrix3 = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];
const XYZ_TO_LIN_SRGB: Matrix3 = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
];
const LIN_P3_TO_XYZ: Matrix3 = [
  [608311 / 1250200, 189793 / 714400, 198249 / 1000160],
  [35783 / 156275, 247089 / 357200, 198249 / 2500400],
  [0, 32229 / 714400, 5220557 / 5000800],
];
const XYZ_TO_LIN_P3: Matrix3 = [
  [446124 / 178915, -333277 / 357830, -72051 / 178915],
  [-14852 / 17905, 63121 / 35810, 423 / 17905],
  [11844 / 330415, -50337 / 660830, 316169 / 330415],
];

function multiply(matrix: Matrix3, [x, y, z]: Vec3): Vec3 {
  return [
    matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z,
    matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z,
    matrix[2][0] * x + matrix[2][1] * y + matrix[2][2] * z,
  ];
}

function invert(m: Matrix3): Matrix3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const cofactorA = e * i - f * h;
  const cofactorB = f * g - d * i;
  const cofactorC = d * h - e * g;
  const determinant = a * cofactorA + b * cofactorB + c * cofactorC;
  return [
    [
      cofactorA / determinant,
      (c * h - b * i) / determinant,
      (b * f - c * e) / determinant,
    ],
    [
      cofactorB / determinant,
      (a * i - c * g) / determinant,
      (c * d - a * f) / determinant,
    ],
    [
      cofactorC / determinant,
      (b * g - a * h) / determinant,
      (a * e - b * d) / determinant,
    ],
  ];
}

// ── sRGB and Display P3 ────────────────────────────────────────────────────
// Both use the sRGB transfer function. It is odd-symmetric, so a component
// below 0 or above 1 converts to a matching out-of-range value instead of NaN.

/** sRGB-encoded (gamma) component to linear light. Any real number. */
export function srgbToLinear(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= 0.04045) return value / 12.92;
  return Math.sign(value) * ((magnitude + 0.055) / 1.055) ** 2.4;
}

/** Linear-light component to sRGB-encoded (gamma). Any real number. */
export function linearToSrgb(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= 0.0031308) return value * 12.92;
  return Math.sign(value) * (1.055 * magnitude ** (1 / 2.4) - 0.055);
}

/** Gamma-encoded sRGB (0..1 per channel) to linear light. */
export function srgbTripleToLinear(rgb: Vec3): Vec3 {
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
}

/** Linear light to gamma-encoded sRGB. Out-of-gamut components stay out of 0..1. */
export function linearToSrgbTriple(lin: Vec3): Vec3 {
  return [linearToSrgb(lin[0]), linearToSrgb(lin[1]), linearToSrgb(lin[2])];
}

/** Linear sRGB to gamma-encoded Display P3 (0..1 inside P3). */
export function linearSrgbToDisplayP3(lin: Vec3): Vec3 {
  return linearToSrgbTriple(
    multiply(XYZ_TO_LIN_P3, multiply(LIN_SRGB_TO_XYZ, lin)),
  );
}

/** Gamma-encoded Display P3 to linear sRGB (outside 0..1 for P3-only colors). */
export function displayP3ToLinearSrgb(p3: Vec3): Vec3 {
  return multiply(
    XYZ_TO_LIN_SRGB,
    multiply(LIN_P3_TO_XYZ, srgbTripleToLinear(p3)),
  );
}

/** An 8-bit sRGB color to linear light. Alpha is not carried. */
export function rgbaToLinearSrgb(color: RgbaColor): Vec3 {
  return srgbTripleToLinear([color.r / 255, color.g / 255, color.b / 255]);
}

/**
 * Linear light to an 8-bit sRGB color. A color outside sRGB is GAMUT-MAPPED
 * first (`mapToGamut`), so the result is the CSS Color 4 fallback for sRGB
 * and not a per-channel clip. Use `isInGamut(lin, "srgb")` to know whether
 * that happened.
 */
export function linearToRgbaGamutMapped(lin: Vec3, alpha: number): RgbaColor {
  const [r, g, b] = linearToSrgbTriple(mapToGamut(lin, "srgb"));
  return {
    r: Math.round(clampUnit(r) * 255),
    g: Math.round(clampUnit(g) * 255),
    b: Math.round(clampUnit(b) * 255),
    a: clampUnit(alpha),
  };
}

// ── OKLab / OKLCH ──────────────────────────────────────────────────────────

/** Below this chroma a color is gray and its OKLCH hue is noise. */
export const OKLCH_ACHROMATIC_CHROMA = 2e-4;

// Ottosson's forward matrices. The inverses are computed from them rather than
// copied from the post, whose rounded inverse constants are only accurate to
// about 1e-7: a color would drift a little on every conversion round trip.
const LINEAR_SRGB_TO_LMS: Matrix3 = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];
const LMS_PRIME_TO_OKLAB: Matrix3 = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];
const OKLAB_TO_LMS_PRIME = invert(LMS_PRIME_TO_OKLAB);
const LMS_TO_LINEAR_SRGB = invert(LINEAR_SRGB_TO_LMS);

export function linearSrgbToOklab(lin: Vec3): Vec3 {
  const [l, m, s] = multiply(LINEAR_SRGB_TO_LMS, lin);
  return multiply(LMS_PRIME_TO_OKLAB, [
    Math.cbrt(l),
    Math.cbrt(m),
    Math.cbrt(s),
  ]);
}

export function oklabToLinearSrgb(lab: Vec3): Vec3 {
  const [l, m, s] = multiply(OKLAB_TO_LMS_PRIME, lab);
  return multiply(LMS_TO_LINEAR_SRGB, [l ** 3, m ** 3, s ** 3]);
}

/**
 * Linear sRGB to OKLCH. `hueHint` is returned as the hue of a gray, so the
 * picker keeps the hue the user last had instead of snapping to noise.
 */
export function linearSrgbToOklch(lin: Vec3, hueHint = 0): Oklch {
  const [l, a, b] = linearSrgbToOklab(lin);
  const c = Math.hypot(a, b);
  const h =
    c < OKLCH_ACHROMATIC_CHROMA
      ? hueHint
      : normalizeHue((Math.atan2(b, a) * 180) / Math.PI);
  return { l, c, h };
}

export function oklchToLinearSrgb({ l, c, h }: Oklch): Vec3 {
  const radians = (h * Math.PI) / 180;
  return oklabToLinearSrgb([l, c * Math.cos(radians), c * Math.sin(radians)]);
}

/** Euclidean distance in OKLab: the ΔEOK the CSS gamut-mapping algorithm uses. */
export function deltaEOk(a: Vec3, b: Vec3): number {
  const labA = linearSrgbToOklab(a);
  const labB = linearSrgbToOklab(b);
  return Math.hypot(labA[0] - labB[0], labA[1] - labB[1], labA[2] - labB[2]);
}

// ── HSB (HSV) and HSL on gamma-encoded triples ─────────────────────────────
// These work on any gamma-encoded RGB triple in 0..1: sRGB for the sRGB modes,
// Display P3 for the P3 square. Hue is in degrees; the rest are 0..1.

export function rgbToHsv([r, g, b]: Vec3, hueHint = 0): Hsv {
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  return {
    h: delta === 0 ? hueHint : hueOf(r, g, b, max, delta),
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

export function hsvToRgb({ h, s, v }: Hsv): Vec3 {
  const channel = (n: number) => {
    const k = (n + normalizeHue(h) / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [channel(5), channel(3), channel(1)];
}

export function rgbToHsl([r, g, b]: Vec3, hueHint = 0): Hsl {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  return {
    h: delta === 0 ? hueHint : hueOf(r, g, b, max, delta),
    s: delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1)),
    l,
  };
}

export function hslToRgb({ h, s, l }: Hsl): Vec3 {
  const amount = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + normalizeHue(h) / 30) % 12;
    return l - amount * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

function hueOf(
  r: number,
  g: number,
  b: number,
  max: number,
  delta: number,
): number {
  const sector =
    max === r
      ? (g - b) / delta + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return normalizeHue(sector * 60);
}

// ── Gamuts and gamut mapping ───────────────────────────────────────────────

/** Tolerance for "inside the gamut": conversions drift by about this much. */
export const GAMUT_EPSILON = 1e-4;

/** Round-trip error of lightness, so an authored 100% or 0% still reads as white or black. */
const LIGHTNESS_EPSILON = 1e-9;

/** The ΔEOK under which a clipped color is close enough to stand in (CSS Color 4). */
const JUST_NOTICEABLE_DIFFERENCE = 0.02;

function encodeIn(lin: Vec3, gamut: Gamut): Vec3 {
  return gamut === "p3" ? linearSrgbToDisplayP3(lin) : linearToSrgbTriple(lin);
}

function decodeFrom(encoded: Vec3, gamut: Gamut): Vec3 {
  return gamut === "p3"
    ? displayP3ToLinearSrgb(encoded)
    : srgbTripleToLinear(encoded);
}

/** Whether the color is inside the gamut, within `GAMUT_EPSILON`. */
export function isInGamut(lin: Vec3, gamut: Gamut): boolean {
  return encodeIn(lin, gamut).every(
    (channel) => channel >= -GAMUT_EPSILON && channel <= 1 + GAMUT_EPSILON,
  );
}

/** The narrowest gamut that holds the color; `wide` means outside Display P3. */
export function gamutOf(lin: Vec3): Gamut | "wide" {
  if (isInGamut(lin, "srgb")) return "srgb";
  if (isInGamut(lin, "p3")) return "p3";
  return "wide";
}

/** Clamps each channel of the color's encoding in `gamut`: hue shifts, chroma is lost unevenly. */
export function clipToGamut(lin: Vec3, gamut: Gamut): Vec3 {
  const [r, g, b] = encodeIn(lin, gamut);
  return decodeFrom([clampUnit(r), clampUnit(g), clampUnit(b)], gamut);
}

/**
 * The CSS Color 4 gamut-mapping algorithm: keep OKLCH lightness and hue,
 * lower chroma until the clipped color is within a just-noticeable difference
 * of the candidate. A color already inside `gamut` comes back unchanged
 * (tidied of tiny conversion drift); the result is always inside `gamut`.
 */
export function mapToGamut(lin: Vec3, gamut: Gamut): Vec3 {
  const origin = linearSrgbToOklch(lin);
  if (origin.l >= 1 - LIGHTNESS_EPSILON) return [1, 1, 1];
  if (origin.l <= LIGHTNESS_EPSILON) return [0, 0, 0];
  if (isInGamut(lin, gamut)) return clipToGamut(lin, gamut);

  let clipped = clipToGamut(lin, gamut);
  if (deltaEOk(clipped, lin) < JUST_NOTICEABLE_DIFFERENCE) return clipped;

  let min = 0;
  let max = origin.c;
  let minIsInGamut = true;
  while (max - min > GAMUT_EPSILON) {
    const chroma = (min + max) / 2;
    const candidate = oklchToLinearSrgb({ ...origin, c: chroma });
    if (minIsInGamut && isInGamut(candidate, gamut)) {
      min = chroma;
      continue;
    }
    clipped = clipToGamut(candidate, gamut);
    const error = deltaEOk(clipped, candidate);
    if (error < JUST_NOTICEABLE_DIFFERENCE) {
      if (JUST_NOTICEABLE_DIFFERENCE - error < GAMUT_EPSILON) return clipped;
      minIsInGamut = false;
      min = chroma;
    } else {
      max = chroma;
    }
  }
  return clipped;
}

// ── Mode channels ──────────────────────────────────────────────────────────

/**
 * The numbers a mode's value cells show for a color:
 * - hex, rgb: [r, g, b] as 0..255
 * - hsl: [hue°, saturation %, lightness %]; hsb: [hue°, saturation %, brightness %]
 * - p3: [r, g, b] as 0..1 in Display P3
 * - oklch: [lightness %, chroma, hue°]
 * The sRGB modes show the color gamut-mapped into sRGB and p3 shows it mapped
 * into Display P3; oklch shows the color itself, even past both. Values are
 * unrounded. `hueHint` is the hue to show for a gray.
 */
export function readModeChannels(
  mode: ColorMode,
  lin: Vec3,
  hueHint = 0,
): number[] {
  switch (mode) {
    case "hex":
    case "rgb": {
      const rgb = linearToSrgbTriple(mapToGamut(lin, "srgb")).map(clampUnit);
      return rgb.map((channel) => channel * 255);
    }
    case "hsl": {
      const hsl = rgbToHsl(srgbMapped(lin), hueHint);
      return [hsl.h, hsl.s * 100, hsl.l * 100];
    }
    case "hsb": {
      const hsv = rgbToHsv(srgbMapped(lin), hueHint);
      return [hsv.h, hsv.s * 100, hsv.v * 100];
    }
    case "p3":
      return linearSrgbToDisplayP3(mapToGamut(lin, "p3")).map(clampUnit);
    case "oklch": {
      const oklch = linearSrgbToOklch(lin, hueHint);
      return [oklch.l * 100, oklch.c, oklch.h];
    }
  }
}

/** The color a mode's value cells describe: the inverse of `readModeChannels`. */
export function linearFromModeChannels(
  mode: ColorMode,
  channels: readonly number[],
): Vec3 {
  const [a = 0, b = 0, c = 0] = channels;
  switch (mode) {
    case "hex":
    case "rgb":
      return srgbTripleToLinear([a / 255, b / 255, c / 255]);
    case "hsl":
      return srgbTripleToLinear(hslToRgb({ h: a, s: b / 100, l: c / 100 }));
    case "hsb":
      return srgbTripleToLinear(hsvToRgb({ h: a, s: b / 100, v: c / 100 }));
    case "p3":
      return displayP3ToLinearSrgb([a, b, c]);
    case "oklch":
      return oklchToLinearSrgb({ l: a / 100, c: b, h: c });
  }
}

function srgbMapped(lin: Vec3): Vec3 {
  const [r, g, b] = linearToSrgbTriple(mapToGamut(lin, "srgb"));
  return [clampUnit(r), clampUnit(g), clampUnit(b)];
}

// ── CSS: oklch() and color() ───────────────────────────────────────────────

/** A color authored as `oklch()`, `color(display-p3 …)` or `color(srgb …)`. */
export type WideColor =
  | { notation: "oklch"; oklch: Oklch; alpha: number; linear: Vec3 }
  | { notation: "display-p3"; p3: Vec3; alpha: number; linear: Vec3 }
  | { notation: "srgb"; srgb: Vec3; alpha: number; linear: Vec3 };

export type WideColorParse =
  | { kind: "ok"; color: WideColor }
  /** A CSS color function this editor does not edit (`lab()`, `color(rec2020 …)`). */
  | { kind: "unsupported"; name: string }
  /** Starts like `oklch()` or `color()` but is not a valid color. */
  | { kind: "invalid" };

const UNSUPPORTED_COLOR_FUNCTION =
  /^(oklab|lab|lch|hwb|color-mix|light-dark)\(/i;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const NUMBER_WITH_UNIT = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i;
/** Percent of chroma that is 100% in `oklch()`: 0.4 (CSS Color 4). */
const OKLCH_CHROMA_AT_100_PERCENT = 0.4;

/**
 * Reads `oklch(…)` and `color(display-p3 …)` / `color(srgb …)`, with optional
 * `/ alpha`. Returns null when the string is neither (hex, the functional
 * RGB and HSL notations and color names belong to `parseCssColor`), `unsupported` for color functions this
 * editor cannot edit, and `invalid` for a malformed one. `none` reads as 0.
 * Negative lightness and chroma read as 0; lightness above 1 is kept and
 * gamut-maps to white. Nothing is clamped to a gamut.
 */
export function parseWideColor(css: string): WideColorParse | null {
  const text = css.trim();
  if (UNSUPPORTED_COLOR_FUNCTION.test(text)) {
    return { kind: "unsupported", name: text.slice(0, text.indexOf("(")) };
  }
  const match = /^(oklch|color)\(([^()]*)\)$/i.exec(text);
  if (!match) {
    return /^(oklch|color)\(/i.test(text) ? { kind: "invalid" } : null;
  }
  const fn = match[1]!.toLowerCase();
  const parts = match[2]!.split("/");
  if (parts.length > 2) return { kind: "invalid" };
  const tokens = parts[0]!.trim().split(/\s+/).filter(Boolean);
  const alpha = parts[1] === undefined ? 1 : parseAlpha(parts[1].trim());
  if (alpha === null) return { kind: "invalid" };

  if (fn === "oklch") {
    if (tokens.length !== 3) return { kind: "invalid" };
    const l = parseChannel(tokens[0]!, 1);
    const c = parseChannel(tokens[1]!, OKLCH_CHROMA_AT_100_PERCENT);
    const h = parseHue(tokens[2]!);
    if (l === null || c === null || h === null) return { kind: "invalid" };
    const oklch: Oklch = { l: Math.max(0, l), c: Math.max(0, c), h };
    return {
      kind: "ok",
      color: {
        notation: "oklch",
        oklch,
        alpha,
        linear: oklchToLinearSrgb(oklch),
      },
    };
  }

  const space = tokens[0]?.toLowerCase();
  if (space !== "display-p3" && space !== "srgb") {
    return space === undefined
      ? { kind: "invalid" }
      : { kind: "unsupported", name: `color(${space})` };
  }
  if (tokens.length !== 4) return { kind: "invalid" };
  const channels = tokens.slice(1).map((token) => parseChannel(token, 1));
  if (channels.some((channel) => channel === null)) return { kind: "invalid" };
  const triple = channels as Vec3;
  return {
    kind: "ok",
    color:
      space === "display-p3"
        ? {
            notation: "display-p3",
            p3: triple,
            alpha,
            linear: displayP3ToLinearSrgb(triple),
          }
        : {
            notation: "srgb",
            srgb: triple,
            alpha,
            linear: srgbTripleToLinear(triple),
          },
  };
}

function parseChannel(token: string, percentScale: number): number | null {
  if (token.toLowerCase() === "none") return 0;
  const match = NUMBER_WITH_UNIT.exec(token);
  if (!match) return null;
  const value = Number(match[1]);
  if (match[2] === "") return value;
  return match[2] === "%" ? (value / 100) * percentScale : null;
}

function parseHue(token: string): number | null {
  if (token.toLowerCase() === "none") return 0;
  const match = NUMBER_WITH_UNIT.exec(token);
  if (!match) return null;
  const value = Number(match[1]);
  switch (match[2]!.toLowerCase()) {
    case "":
    case "deg":
      return normalizeHue(value);
    case "grad":
      return normalizeHue(value * 0.9);
    case "rad":
      return normalizeHue((value * 180) / Math.PI);
    case "turn":
      return normalizeHue(value * 360);
    default:
      return null;
  }
}

function parseAlpha(token: string): number | null {
  if (token.toLowerCase() === "none") return 0;
  if (NUMBER.test(token)) return clampUnit(Number(token));
  const match = NUMBER_WITH_UNIT.exec(token);
  if (match?.[2] === "%") return clampUnit(Number(match[1]) / 100);
  return null;
}

/** `oklch()` for the numbers as given: up to 4 decimals of lightness %, 6 of chroma and 4 of hue. */
export function formatOklchCss(oklch: Oklch, alpha = 1): string {
  return writeOklch(oklch, alpha, VERBATIM_DECIMALS);
}

/** `color(srgb …)` for gamma-encoded channels as given (0..1, or beyond for a wide color), to at most 6 decimals. */
export function formatSrgbColorCss(srgb: Vec3, alpha = 1): string {
  assertFinite("srgb", ...srgb, alpha);
  const slash = alpha < 1 ? ` / ${trimNumber(clampUnit(alpha), 3)}` : "";
  return `color(srgb ${srgb.map((channel) => trimNumber(channel, VERBATIM_DECIMALS + 3)).join(" ")}${slash})`;
}

/** `color(display-p3 …)` for the channels as given (0..1), to at most 6 decimals. */
export function formatDisplayP3Css(p3: Vec3, alpha = 1): string {
  return writeDisplayP3(p3, alpha, VERBATIM_DECIMALS);
}

/**
 * `oklch()` for a color with the FEWEST decimals that read back as the same
 * color, so a simple color stays short and a rewrite never drifts. The color
 * is written as it is: past sRGB and past Display P3 it stays what it is.
 */
export function formatLinearAsOklchCss(
  lin: Vec3,
  alpha = 1,
  hueHint = 0,
): string {
  const oklch = linearSrgbToOklch(lin, hueHint);
  return shortestRoundTrip(lin, (extra) => writeOklch(oklch, alpha, extra));
}

/**
 * `color(display-p3 …)` for a color with the fewest decimals that read back as
 * the same color. A color outside Display P3 is gamut-mapped into it first, so
 * check `gamutOf` beforehand to tell the user.
 */
export function formatLinearAsDisplayP3Css(lin: Vec3, alpha = 1): string {
  const inside = mapToGamut(lin, "p3");
  const p3 = linearSrgbToDisplayP3(inside).map(clampUnit) as Vec3;
  return shortestRoundTrip(inside, (extra) => writeDisplayP3(p3, alpha, extra));
}

/** Extra decimals past the shortest form (1 of lightness %, 3 of chroma, 3 of P3): 0 is shortest, 3 is the most we write. */
const VERBATIM_DECIMALS = 3;

function shortestRoundTrip(
  expected: Vec3,
  write: (extraDecimals: number) => string,
): string {
  for (let extra = 0; extra < VERBATIM_DECIMALS; extra += 1) {
    const text = write(extra);
    const parsed = parseWideColor(text);
    if (
      parsed?.kind === "ok" &&
      sameColorAt8Bit(parsed.color.linear, expected)
    ) {
      return text;
    }
  }
  return write(VERBATIM_DECIMALS);
}

/**
 * Same color at 8 bits per channel in the narrowest gamut that holds it, and
 * for a color past Display P3 the same OKLab to a thousandth.
 */
function sameColorAt8Bit(a: Vec3, b: Vec3): boolean {
  const gamut = gamutOf(b);
  if (gamut === "wide") {
    const labA = linearSrgbToOklab(a);
    const labB = linearSrgbToOklab(b);
    return labA.every(
      (channel, index) => Math.abs(channel - labB[index]!) < 1e-3,
    );
  }
  const encodedA = encodeIn(a, gamut);
  const encodedB = encodeIn(b, gamut);
  return encodedA.every(
    (channel, index) =>
      Math.round(clampUnit(channel) * 255) ===
      Math.round(clampUnit(encodedB[index]!) * 255),
  );
}

// Lightness and chroma below 0 are written as 0, which is how CSS reads them.
function writeOklch(oklch: Oklch, alpha: number, extra: number): string {
  assertFinite("oklch", oklch.l, oklch.c, oklch.h, alpha);
  const slash = alpha < 1 ? ` / ${trimNumber(clampUnit(alpha) * 100, 2)}%` : "";
  return `oklch(${trimNumber(Math.max(0, oklch.l) * 100, 1 + extra)}% ${trimNumber(Math.max(0, oklch.c), 3 + extra)} ${trimNumber(normalizeHue(oklch.h), 1 + extra)}${slash})`;
}

function writeDisplayP3(p3: Vec3, alpha: number, extra: number): string {
  assertFinite("display-p3", ...p3, alpha);
  const slash = alpha < 1 ? ` / ${trimNumber(clampUnit(alpha), 3)}` : "";
  return `color(display-p3 ${p3.map((channel) => trimNumber(channel, 3 + extra)).join(" ")}${slash})`;
}

function assertFinite(notation: string, ...values: number[]): void {
  if (values.some((value) => !Number.isFinite(value))) {
    throw new RangeError(`Cannot write a non-finite ${notation} color`);
  }
}

function trimNumber(value: number, decimals: number): string {
  return Number(value.toFixed(Math.max(0, decimals))).toString();
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeHue(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}
