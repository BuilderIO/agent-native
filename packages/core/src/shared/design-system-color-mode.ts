/**
 * One derivation of "is this design system dark or light", shared by every
 * surface that hands a design system to a generating agent.
 *
 * Raw tokens alone do not survive the trip: a model reading
 * a dark background token inside a JSON blob, next to a prose directive
 * that says to use a light canvas, reliably picks the prose. So the color mode
 * is derived once here and stated in words next to the tokens.
 */

export type DesignSystemColorMode = "dark" | "light";

// guard:allow-raw-color - the CSS named-color table, parser input rather than
// UI colors. Without it a value like `lightgray` is unreadable to the parser,
// which silently means "not checked" and lets an unreadable pair through.
const CSS_NAMED_COLORS: Record<string, string> = {
  aliceblue: "f0f8ff",
  antiquewhite: "faebd7",
  aqua: "00ffff",
  aquamarine: "7fffd4",
  azure: "f0ffff",
  beige: "f5f5dc",
  bisque: "ffe4c4",
  black: "000000",
  blanchedalmond: "ffebcd",
  blue: "0000ff",
  blueviolet: "8a2be2",
  brown: "a52a2a",
  burlywood: "deb887",
  cadetblue: "5f9ea0",
  chartreuse: "7fff00",
  chocolate: "d2691e",
  coral: "ff7f50",
  cornflowerblue: "6495ed",
  cornsilk: "fff8dc",
  crimson: "dc143c",
  cyan: "00ffff",
  darkblue: "00008b",
  darkcyan: "008b8b",
  darkgoldenrod: "b8860b",
  darkgray: "a9a9a9",
  darkgreen: "006400",
  darkgrey: "a9a9a9",
  darkkhaki: "bdb76b",
  darkmagenta: "8b008b",
  darkolivegreen: "556b2f",
  darkorange: "ff8c00",
  darkorchid: "9932cc",
  darkred: "8b0000",
  darksalmon: "e9967a",
  darkseagreen: "8fbc8f",
  darkslateblue: "483d8b",
  darkslategray: "2f4f4f",
  darkslategrey: "2f4f4f",
  darkturquoise: "00ced1",
  darkviolet: "9400d3",
  deeppink: "ff1493",
  deepskyblue: "00bfff",
  dimgray: "696969",
  dimgrey: "696969",
  dodgerblue: "1e90ff",
  firebrick: "b22222",
  floralwhite: "fffaf0",
  forestgreen: "228b22",
  fuchsia: "ff00ff",
  gainsboro: "dcdcdc",
  ghostwhite: "f8f8ff",
  gold: "ffd700",
  goldenrod: "daa520",
  gray: "808080",
  green: "008000",
  greenyellow: "adff2f",
  grey: "808080",
  honeydew: "f0fff0",
  hotpink: "ff69b4",
  indianred: "cd5c5c",
  indigo: "4b0082",
  ivory: "fffff0",
  khaki: "f0e68c",
  lavender: "e6e6fa",
  lavenderblush: "fff0f5",
  lawngreen: "7cfc00",
  lemonchiffon: "fffacd",
  lightblue: "add8e6",
  lightcoral: "f08080",
  lightcyan: "e0ffff",
  lightgoldenrodyellow: "fafad2",
  lightgray: "d3d3d3",
  lightgreen: "90ee90",
  lightgrey: "d3d3d3",
  lightpink: "ffb6c1",
  lightsalmon: "ffa07a",
  lightseagreen: "20b2aa",
  lightskyblue: "87cefa",
  lightslategray: "778899",
  lightslategrey: "778899",
  lightsteelblue: "b0c4de",
  lightyellow: "ffffe0",
  lime: "00ff00",
  limegreen: "32cd32",
  linen: "faf0e6",
  magenta: "ff00ff",
  maroon: "800000",
  mediumaquamarine: "66cdaa",
  mediumblue: "0000cd",
  mediumorchid: "ba55d3",
  mediumpurple: "9370db",
  mediumseagreen: "3cb371",
  mediumslateblue: "7b68ee",
  mediumspringgreen: "00fa9a",
  mediumturquoise: "48d1cc",
  mediumvioletred: "c71585",
  midnightblue: "191970",
  mintcream: "f5fffa",
  mistyrose: "ffe4e1",
  moccasin: "ffe4b5",
  navajowhite: "ffdead",
  navy: "000080",
  oldlace: "fdf5e6",
  olive: "808000",
  olivedrab: "6b8e23",
  orange: "ffa500",
  orangered: "ff4500",
  orchid: "da70d6",
  palegoldenrod: "eee8aa",
  palegreen: "98fb98",
  paleturquoise: "afeeee",
  palevioletred: "db7093",
  papayawhip: "ffefd5",
  peachpuff: "ffdab9",
  peru: "cd853f",
  pink: "ffc0cb",
  plum: "dda0dd",
  powderblue: "b0e0e6",
  purple: "800080",
  rebeccapurple: "663399",
  red: "ff0000",
  rosybrown: "bc8f8f",
  royalblue: "4169e1",
  saddlebrown: "8b4513",
  salmon: "fa8072",
  sandybrown: "f4a460",
  seagreen: "2e8b57",
  seashell: "fff5ee",
  sienna: "a0522d",
  silver: "c0c0c0",
  skyblue: "87ceeb",
  slateblue: "6a5acd",
  slategray: "708090",
  slategrey: "708090",
  snow: "fffafa",
  springgreen: "00ff7f",
  steelblue: "4682b4",
  tan: "d2b48c",
  teal: "008080",
  thistle: "d8bfd8",
  tomato: "ff6347",
  turquoise: "40e0d0",
  violet: "ee82ee",
  wheat: "f5deb3",
  white: "ffffff",
  whitesmoke: "f5f5f5",
  yellow: "ffff00",
  yellowgreen: "9acd32",
};

/** Bare color words inside a larger value, e.g. a gradient stop. Matched
 *  against the table above rather than treated as an arbitrary identifier. */
const NAMED_COLOR_WORD = /\b[a-z]{3,20}\b/g;

/** Tailwind background utilities carry no CSS value here, so map the ones a
 *  slide background can legally be set to. Shades 900/950 and pure black are
 *  the only dark members of that set. */
const DARK_TAILWIND_BACKGROUND =
  /^bg-(?:black|(?:slate|gray|grey|zinc|neutral|stone)-(?:800|900|950))$/i;
const LIGHT_TAILWIND_BACKGROUND =
  /^bg-(?:white|(?:slate|gray|grey|zinc|neutral|stone)-(?:50|100|200))$/i;

/** Red, green, blue (0-255) and alpha (0-1). */
export type Rgba = [number, number, number, number];

const HEX_DIGITS = /^[\da-f]+$/;

/**
 * The channels of a single CSS color literal, or null when the value carries
 * no readable color (a variable, a gradient, an image URL). Alpha is kept:
 * translucent black text on white renders as grey, and discarding alpha would
 * score it as a perfect 21:1 pass.
 */
export function cssColorChannels(value: unknown): Rgba | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  const named = CSS_NAMED_COLORS[normalized];
  if (named) return hexChannels(named);
  if (normalized.startsWith("#")) return hexChannels(normalized);
  return functionalChannels(normalized);
}

function hexChannels(hex: string): Rgba | null {
  const value = hex.replace("#", "");
  // Length alone does not make a hex literal: a payload of non-hex letters
  // parses to NaN channels, and a NaN contrast ratio compares false against
  // every threshold, so an unreadable pairing would be reported as a pass.
  if (!HEX_DIGITS.test(value)) return null;
  if (value.length === 3 || value.length === 4) {
    const [r, g, b] = value
      .slice(0, 3)
      .split("")
      .map((channel) => parseInt(channel + channel, 16));
    return [
      r!,
      g!,
      b!,
      value.length === 4 ? parseInt(value[3]! + value[3]!, 16) / 255 : 1,
    ];
  }
  if (value.length === 6 || value.length === 8) {
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
      value.length === 8 ? parseInt(value.slice(6, 8), 16) / 255 : 1,
    ];
  }
  return null;
}

function functionalChannels(value: string): Rgba | null {
  const rgb = value.match(
    /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)(?:[\s,/]+([\d.]+)(%?))?/i,
  );
  if (rgb) {
    return [
      rgbChannel(rgb[1]!, rgb[2]),
      rgbChannel(rgb[3]!, rgb[4]),
      rgbChannel(rgb[5]!, rgb[6]),
      parseAlpha(rgb[7], rgb[8]),
    ];
  }

  const hsl = value.match(
    /^hsla?\(\s*([\d.]+)(deg|rad|grad|turn)?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?(?:[\s,/]+([\d.]+)(%?))?/i,
  );
  if (hsl) {
    const [r, g, b] = hslChannels(
      hueDegrees(Number(hsl[1]), hsl[2]),
      clamp01(Number(hsl[3]) / 100),
      clamp01(Number(hsl[4]) / 100),
    );
    return [r, g, b, parseAlpha(hsl[5], hsl[6])];
  }

  // The lightness-first spaces (oklch/oklab/lch/lab) state a perceptual
  // lightness, which reads closely enough as a grey of that lightness to rank
  // a canvas without a full color-space conversion. hsl cannot be read that
  // way: its L is the midpoint between the pure hue and white, so a saturated
  // hue at 50% is far darker than mid-grey.
  const lightnessFirst = value.match(
    /^(?:oklch|oklab|lch|lab)\(\s*([\d.]+)(%?)[^)/]*(?:\/\s*([\d.]+)(%?))?/i,
  );
  if (lightnessFirst) {
    const raw = Number(lightnessFirst[1]);
    const normalized =
      lightnessFirst[2] === "%" ? raw / 100 : raw > 1 ? raw / 100 : raw;
    const channel = Math.round(clamp01(normalized) * 255);
    return [
      channel,
      channel,
      channel,
      parseAlpha(lightnessFirst[3], lightnessFirst[4]),
    ];
  }
  return null;
}

/** One red/green/blue channel, which CSS states as 0-255 or as a percentage. */
function rgbChannel(raw: string, percent: string | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0;
  const scaled = percent === "%" ? (value / 100) * 255 : value;
  return Math.min(Math.max(scaled, 0), 255);
}

function hueDegrees(raw: number, unit: string | undefined): number {
  if (!Number.isFinite(raw)) return 0;
  if (unit === "rad") return (raw * 180) / Math.PI;
  if (unit === "grad") return raw * 0.9;
  if (unit === "turn") return raw * 360;
  return raw;
}

function hslChannels(
  hue: number,
  saturation: number,
  lightness: number,
): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = (((hue % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const rgb: [number, number, number] =
    sector < 1
      ? [chroma, second, 0]
      : sector < 2
        ? [second, chroma, 0]
        : sector < 3
          ? [0, chroma, second]
          : sector < 4
            ? [0, second, chroma]
            : sector < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  const offset = lightness - chroma / 2;
  return [
    Math.round((rgb[0] + offset) * 255),
    Math.round((rgb[1] + offset) * 255),
    Math.round((rgb[2] + offset) * 255),
  ];
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

/** A CSS alpha term, as a number or a percentage. Absent means opaque. */
function parseAlpha(raw: string | undefined, percent: string | undefined) {
  if (raw === undefined) return 1;
  const value = percent === "%" ? Number(raw) / 100 : Number(raw);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 1;
}

/**
 * Perceived-brightness test for a single CSS color. Returns null when the
 * value carries no readable color — "unreadable" must stay distinct from
 * "light", or an unparseable token silently votes for the light default that
 * caused this bug.
 */
export function isDarkColorValue(value: unknown): boolean | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (DARK_TAILWIND_BACKGROUND.test(normalized)) return true;
  if (LIGHT_TAILWIND_BACKGROUND.test(normalized)) return false;

  const single = cssColorChannels(normalized);
  if (single) return isDarkChannels(single);

  // A gradient is dark only when every stop it declares is dark; a light stop
  // anywhere means text sized for a dark canvas will collide with it.
  const stops = [
    ...normalized.matchAll(/#[\da-f]{3,8}\b/gi),
    ...normalized.matchAll(/rgba?\([^)]*\)/gi),
    ...normalized.matchAll(/(?:hsla?|oklch|oklab|lch|lab)\([^)]*\)/gi),
    ...normalized.matchAll(NAMED_COLOR_WORD),
  ].map((match) => match[0]);

  if (stops.length === 0) return null;

  let dark = 0;
  let readable = 0;
  for (const stop of stops) {
    const channels = cssColorChannels(stop);
    // A fully transparent stop paints nothing, so its channels say nothing
    // about how the canvas reads.
    if (!channels || channels[3] === 0) continue;
    readable += 1;
    if (isDarkChannels(channels)) dark += 1;
  }

  if (readable === 0) return null;
  return dark === readable;
}

function isDarkChannels([r, g, b]: Rgba): boolean {
  return r * 0.299 + g * 0.587 + b * 0.114 < 128;
}

export interface DesignSystemColorTokens {
  background?: unknown;
  text?: unknown;
  surface?: unknown;
}

export interface DesignSystemColorModeResult {
  mode: DesignSystemColorMode;
  /** The token the mode was read from, so the directive can quote it. */
  background: string;
  text?: string;
}

/**
 * Derive the color mode from a design system's color tokens. `background` is
 * authoritative; `text` only breaks a tie when the background is unreadable
 * (a CSS variable, an image URL, an unmapped utility class).
 *
 * Returns null when neither token is readable. Callers must treat that as
 * "unknown", never as "light".
 */
export function designSystemColorMode(
  colors: DesignSystemColorTokens | null | undefined,
): DesignSystemColorModeResult | null {
  if (!colors) return null;
  const background =
    typeof colors.background === "string" ? colors.background.trim() : "";
  const text = typeof colors.text === "string" ? colors.text.trim() : "";

  const backgroundIsDark = isDarkColorValue(background);
  if (backgroundIsDark !== null) {
    return {
      mode: backgroundIsDark ? "dark" : "light",
      background,
      ...(text ? { text } : {}),
    };
  }

  // No readable background: an explicitly light text color only makes sense on
  // a dark canvas, so it is the next best signal.
  const textIsDark = isDarkColorValue(text);
  if (textIsDark !== null) {
    const surface =
      typeof colors.surface === "string" ? colors.surface.trim() : "";
    return {
      mode: textIsDark ? "light" : "dark",
      background: background || surface || "(unreadable)",
      ...(text ? { text } : {}),
    };
  }

  return null;
}

/**
 * The lines that state the derived mode to a generating agent. Kept as an
 * array so callers can splice it into an existing context block.
 */
export function formatDesignSystemColorModeDirective(
  result: DesignSystemColorModeResult | null,
  opts?: { compact?: boolean },
): string[] {
  if (!result) {
    return [
      "Color mode: UNDETERMINED from this system's tokens.",
      "Read the background and text tokens above and match them exactly. Do not fall back to a light canvas by default — an unreadable token is not a light token.",
    ];
  }

  const { mode, background, text } = result;

  if (opts?.compact) {
    return [
      `Color mode: ${mode.toUpperCase()} (background ${background}${text ? `, text ${text}` : ""}).`,
      mode === "dark"
        ? "Author every slide on this dark canvas. Ignore any generic light, warm-neutral, or paper fallback elsewhere in this prompt; it applies only when no design system is linked."
        : "Author every slide on this light canvas. Do not use a dark canvas with light text for this system.",
    ];
  }

  if (mode === "dark") {
    return [
      `Color mode: DARK (background token ${background}${text ? `, text token ${text}` : ""}).`,
      `This is a dark design system. Every slide or screen you author must use its dark canvas — set the background to ${background} (or another token from this system of equal darkness) and use the system's light text colors on top of it.`,
      "Ignore any generic instruction elsewhere in this prompt to default to a light, warm-neutral, or paper canvas with dark ink text. That fallback applies only when no design system is linked, and one is linked here.",
      "Do not emit light-on-light or dark-on-dark combinations: re-check contrast for every text, border, icon, and surface color against the dark canvas before writing the markup.",
    ];
  }

  return [
    `Color mode: LIGHT (background token ${background}${text ? `, text token ${text}` : ""}).`,
    `This is a light design system. Every slide or screen you author must use its light canvas — set the background to ${background} (or another token from this system of equal lightness) and use the system's dark text colors on top of it.`,
    "Do not emit a dark canvas with light text for this system, and re-check contrast for every text, border, icon, and surface color before writing the markup.",
  ];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Read the color tokens out of a stored design system `data` payload, which is
 * either the parsed object or its JSON string, and derive the mode. Builder-
 * proxied systems keep the same shape under a flat `tokenValues` record, so
 * both spellings are accepted.
 */
export function designSystemColorModeFromData(
  data: unknown,
): DesignSystemColorModeResult | null {
  let parsed: unknown = data;
  if (typeof data === "string") {
    try {
      parsed = JSON.parse(data);
    } catch {
      // coercion-ok: null is the typed "unreadable" value here, and callers
      // render it as "Color mode: UNDETERMINED" rather than assuming light.
      return null;
    }
  }
  const record = asRecord(parsed);
  if (!record) return null;

  const colors = asRecord(record.colors);
  if (colors) {
    const mode = designSystemColorMode(colors as DesignSystemColorTokens);
    if (mode) return mode;
  }

  const tokenValues = asRecord(record.tokenValues) ?? record;
  const pick = (...names: string[]): unknown => {
    for (const [key, value] of Object.entries(tokenValues)) {
      const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
      if (names.some((name) => normalized.endsWith(name))) return value;
    }
    return undefined;
  };

  return designSystemColorMode({
    background: pick("background", "bg", "canvas"),
    text: pick("text", "foreground", "ink"),
    surface: pick("surface", "card"),
  });
}
