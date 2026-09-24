/**
 * Pure color parsing and WCAG contrast math. No DOM, no slide markup
 * knowledge — `server/lib/slide-contrast.ts` supplies the actual
 * foreground/background pairs pulled out of a slide's HTML.
 */

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ContrastRequirement {
  required: number;
  isLargeText: boolean;
}

const LARGE_TEXT_MIN_PX = 24;
const LARGE_BOLD_TEXT_MIN_PX = 18.66;
const BOLD_FONT_WEIGHT_THRESHOLD = 700;
// WCAG 2.x level AA — the threshold "fix contrast" requests are actually
// judged against; AAA (7:1 / 4.5:1) is not the bar this audit checks.
const NORMAL_TEXT_MIN_RATIO = 4.5;
const LARGE_TEXT_MIN_RATIO = 3;

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, value));
}

function clampAlpha(value: number): number {
  return Math.min(1, Math.max(0, value));
}

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3,8})$/i;

function parseHexColor(value: string): RgbaColor | null {
  const match = HEX_COLOR_PATTERN.exec(value.trim());
  if (!match) return null;
  const hex = match[1];
  if (hex.length === 3 || hex.length === 4) {
    const channels = hex
      .slice(0, 3)
      .split("")
      .map((channel) => parseInt(channel + channel, 16));
    const alphaChar = hex.length === 4 ? hex[3] : null;
    return {
      r: channels[0],
      g: channels[1],
      b: channels[2],
      a: alphaChar ? parseInt(alphaChar + alphaChar, 16) / 255 : 1,
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }
  return null;
}

function parsePercentOrNumber(token: string, max: number): number {
  const trimmed = token.trim();
  if (trimmed.endsWith("%")) return (parseFloat(trimmed) / 100) * max;
  return parseFloat(trimmed);
}

// Does not special-case `var(...)` arguments: by the time a value reaches
// here it has already been through `resolveCssVarChain`, so a real
// custom-property reference has already become a literal or was left
// unresolved on purpose.
const FUNCTIONAL_COLOR_PATTERN = /^(rgba?|hsla?)\(([^)]+)\)$/i;

function hslToRgb(
  hueDegrees: number,
  saturation: number,
  lightness: number,
): { r: number; g: number; b: number } {
  const hue = (((hueDegrees % 360) + 360) % 360) / 360;
  const s = clampAlpha(saturation);
  const l = clampAlpha(lightness);
  if (s === 0) {
    const gray = Math.round(l * 255);
    return { r: gray, g: gray, b: gray };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const toChannel = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(toChannel(hue + 1 / 3) * 255),
    g: Math.round(toChannel(hue) * 255),
    b: Math.round(toChannel(hue - 1 / 3) * 255),
  };
}

function parseFunctionalColor(value: string): RgbaColor | null {
  const match = FUNCTIONAL_COLOR_PATTERN.exec(value.trim());
  if (!match) return null;
  const kind = match[1].toLowerCase();
  const args = match[2].split(/[\s,/]+/).filter(Boolean);
  if (args.length < 3) return null;
  const alphaToken = args[3];
  const alpha =
    alphaToken !== undefined
      ? clampAlpha(parsePercentOrNumber(alphaToken, 1))
      : 1;
  if (kind.startsWith("rgb")) {
    return {
      r: clampChannel(parsePercentOrNumber(args[0], 255)),
      g: clampChannel(parsePercentOrNumber(args[1], 255)),
      b: clampChannel(parsePercentOrNumber(args[2], 255)),
      a: alpha,
    };
  }
  const rgb = hslToRgb(
    parseFloat(args[0]),
    parsePercentOrNumber(args[1], 1),
    parsePercentOrNumber(args[2], 1),
  );
  return { ...rgb, a: alpha };
}

// Author-authored slide colors, not app theme UI — this table exists so the
// audit can resolve a real named CSS color a user typed into a slide, the
// same way a browser would. guard:allow-raw-color - color keyword lookup
// table, not a UI theme literal.
const NAMED_COLORS: Record<string, [number, number, number]> = {
  aqua: [0, 255, 255],
  beige: [245, 245, 220],
  black: [0, 0, 0],
  blue: [0, 0, 255],
  brown: [165, 42, 42],
  chocolate: [210, 105, 30],
  coral: [255, 127, 80],
  crimson: [220, 20, 60],
  cyan: [0, 255, 255],
  darkblue: [0, 0, 139],
  darkgray: [169, 169, 169],
  darkgreen: [0, 100, 0],
  darkgrey: [169, 169, 169],
  darkorange: [255, 140, 0],
  darkred: [139, 0, 0],
  darkslategray: [47, 79, 79],
  darkslategrey: [47, 79, 79],
  dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105],
  dodgerblue: [30, 144, 255],
  firebrick: [178, 34, 34],
  forestgreen: [34, 139, 34],
  fuchsia: [255, 0, 255],
  gainsboro: [220, 220, 220],
  gold: [255, 215, 0],
  goldenrod: [218, 165, 32],
  gray: [128, 128, 128],
  green: [0, 128, 0],
  grey: [128, 128, 128],
  honeydew: [240, 255, 240],
  indigo: [75, 0, 130],
  ivory: [255, 255, 240],
  khaki: [240, 230, 140],
  lavender: [230, 230, 250],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
  lime: [0, 255, 0],
  magenta: [255, 0, 255],
  maroon: [128, 0, 0],
  midnightblue: [25, 25, 112],
  mintcream: [245, 255, 250],
  navy: [0, 0, 128],
  olive: [128, 128, 0],
  orange: [255, 165, 0],
  orangered: [255, 69, 0],
  orchid: [218, 112, 214],
  pink: [255, 192, 203],
  plum: [221, 160, 221],
  purple: [128, 0, 128],
  red: [255, 0, 0],
  royalblue: [65, 105, 225],
  salmon: [250, 128, 114],
  seagreen: [46, 139, 87],
  seashell: [255, 245, 238],
  silver: [192, 192, 192],
  skyblue: [135, 206, 235],
  slategray: [112, 128, 144],
  slategrey: [112, 128, 144],
  snow: [255, 250, 250],
  steelblue: [70, 130, 180],
  tan: [210, 180, 140],
  teal: [0, 128, 128],
  tomato: [255, 99, 71],
  turquoise: [64, 224, 208],
  violet: [238, 130, 238],
  white: [255, 255, 255],
  whitesmoke: [245, 245, 245],
  yellow: [255, 255, 0],
};

// CSS system colors resolved as light-mode values, matching the light
// default this framework's fallback chains assume (see the create-deck
// skill's `Canvas`/`CanvasText`/`GrayText` wrapper contract). A slide that
// genuinely renders in a dark system-color scheme is outside what this
// static audit can know. guard:allow-raw-color - system color approximation.
const SYSTEM_COLOR_KEYWORDS: Record<string, [number, number, number]> = {
  activetext: [255, 0, 0],
  buttonface: [240, 240, 240],
  buttontext: [0, 0, 0],
  canvas: [255, 255, 255],
  canvastext: [0, 0, 0],
  field: [255, 255, 255],
  fieldtext: [0, 0, 0],
  graytext: [109, 109, 109],
  linktext: [0, 0, 238],
};

/**
 * Parse a literal CSS color value (hex, an rgb/rgba function, an hsl/hsla
 * function, a named or system color keyword, or "transparent"). Returns
 * null for anything this audit can't confidently resolve — including
 * "currentcolor", which callers must special-case since it depends on
 * context this function doesn't have.
 */
export function parseCssColor(rawValue: string): RgbaColor | null {
  const value = rawValue.trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = parseHexColor(value);
  if (hex) return hex;
  const functional = parseFunctionalColor(value);
  if (functional) return functional;
  const named = NAMED_COLORS[lower] ?? SYSTEM_COLOR_KEYWORDS[lower];
  if (named) return { r: named[0], g: named[1], b: named[2], a: 1 };
  return null;
}

/** Alpha-composite `top` over `bottom`, producing an opaque result. */
export function compositeOver(top: RgbaColor, bottom: RgbaColor): RgbaColor {
  if (top.a >= 1) return { r: top.r, g: top.g, b: top.b, a: 1 };
  if (top.a <= 0) return { r: bottom.r, g: bottom.g, b: bottom.b, a: 1 };
  const outA = top.a + bottom.a * (1 - top.a);
  if (outA <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (channel: "r" | "g" | "b") =>
    (top[channel] * top.a + bottom[channel] * bottom.a * (1 - top.a)) / outA;
  return {
    r: Math.round(mix("r")),
    g: Math.round(mix("g")),
    b: Math.round(mix("b")),
    a: outA,
  };
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(
  color: Pick<RgbaColor, "r" | "g" | "b">,
): number {
  return (
    0.2126 * srgbChannelToLinear(color.r) +
    0.7152 * srgbChannelToLinear(color.g) +
    0.0722 * srgbChannelToLinear(color.b)
  );
}

/** WCAG contrast ratio between two opaque colors, from 1 to 21. */
export function contrastRatio(
  a: Pick<RgbaColor, "r" | "g" | "b">,
  b: Pick<RgbaColor, "r" | "g" | "b">,
): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.x level AA required ratio for a given rendered text size/weight. */
export function requiredContrastRatio(
  fontSizePx: number,
  bold: boolean,
): ContrastRequirement {
  const isLargeText =
    fontSizePx >= LARGE_TEXT_MIN_PX ||
    (bold && fontSizePx >= LARGE_BOLD_TEXT_MIN_PX);
  return {
    required: isLargeText ? LARGE_TEXT_MIN_RATIO : NORMAL_TEXT_MIN_RATIO,
    isLargeText,
  };
}

export function isBoldFontWeight(value: number): boolean {
  return value >= BOLD_FONT_WEIGHT_THRESHOLD;
}

export function toHexColor(color: Pick<RgbaColor, "r" | "g" | "b">): string {
  const toHex = (channel: number) =>
    clampChannel(Math.round(channel)).toString(16).padStart(2, "0");
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

function findMatchingParen(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevelComma(text: string): [string, string | undefined] {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      return [text.slice(0, i), text.slice(i + 1)];
    }
  }
  return [text, undefined];
}

interface VarCall {
  name: string;
  fallback?: string;
}

function parseVarCall(value: string): VarCall | null {
  const trimmed = value.trim();
  if (!/^var\(/i.test(trimmed) || !trimmed.endsWith(")")) return null;
  const openIndex = trimmed.indexOf("(");
  const closeIndex = findMatchingParen(trimmed, openIndex);
  if (closeIndex !== trimmed.length - 1) return null;
  const inner = trimmed.slice(openIndex + 1, closeIndex);
  const [namePart, fallbackPart] = splitTopLevelComma(inner);
  const name = namePart.trim();
  if (!name.startsWith("--")) return null;
  return { name, fallback: fallbackPart?.trim() };
}

/**
 * Resolve a CSS value that may be a `var(--name, fallback)` reference —
 * including one nested inside another var()'s fallback, the shape every
 * `--deck-*` slide wrapper declaration uses — against a table of already
 * known custom-property values. An unresolved reference with no fallback is
 * returned as-is so `parseCssColor` fails loudly on it instead of a caller
 * guessing a color.
 */
export function resolveCssVarChain(
  value: string,
  variables: ReadonlyMap<string, string>,
  depth = 0,
): string {
  if (depth > 12) return value.trim();
  const trimmed = value.trim();
  const call = parseVarCall(trimmed);
  if (!call) return trimmed;
  const resolved = variables.get(call.name);
  if (resolved !== undefined && resolved.trim() !== "") {
    return resolveCssVarChain(resolved, variables, depth + 1);
  }
  if (call.fallback !== undefined) {
    return resolveCssVarChain(call.fallback, variables, depth + 1);
  }
  return trimmed;
}
