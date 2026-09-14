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

// guard:allow-raw-color - CSS parser input vocabulary, not UI colors: these are
// the literals this module recognizes in a user's own design tokens.
const NAMED_DARK = new Set([
  "black",
  "midnightblue",
  "navy",
  "darkslategray",
  "darkslategrey",
  "#000", // guard:allow-raw-color - parser input literal
  "#000000", // guard:allow-raw-color - parser input literal
]);

// guard:allow-raw-color - CSS parser input vocabulary, not UI colors.
const NAMED_LIGHT = new Set([
  "white",
  "ivory",
  "snow",
  "floralwhite",
  "ghostwhite",
  "#fff", // guard:allow-raw-color - parser input literal
  "#ffffff", // guard:allow-raw-color - parser input literal
]);

/** Tailwind background utilities carry no CSS value here, so map the ones a
 *  slide background can legally be set to. Shades 900/950 and pure black are
 *  the only dark members of that set. */
const DARK_TAILWIND_BACKGROUND =
  /^bg-(?:black|(?:slate|gray|grey|zinc|neutral|stone)-(?:800|900|950))$/i;
const LIGHT_TAILWIND_BACKGROUND =
  /^bg-(?:white|(?:slate|gray|grey|zinc|neutral|stone)-(?:50|100|200))$/i;

/**
 * The RGB channels of a single CSS color literal, or null when the value
 * carries no readable color (a variable, a gradient, an image URL).
 */
export function cssColorChannels(
  value: unknown,
): [number, number, number] | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (NAMED_DARK.has(normalized)) return [0, 0, 0];
  if (NAMED_LIGHT.has(normalized)) return [255, 255, 255];
  if (normalized.startsWith("#")) return hexChannels(normalized);
  return functionalChannels(normalized);
}

function hexChannels(hex: string): [number, number, number] | null {
  const value = hex.replace("#", "");
  if (value.length === 3 || value.length === 4) {
    const [r, g, b] = value
      .slice(0, 3)
      .split("")
      .map((channel) => parseInt(channel + channel, 16));
    return [r!, g!, b!];
  }
  if (value.length === 6 || value.length === 8) {
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ];
  }
  return null;
}

function functionalChannels(value: string): [number, number, number] | null {
  const rgb = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  // hsl and the lightness-first spaces (oklch/oklab/lch/lab) can be read as a
  // grey of the same lightness without a full color-space conversion. hsl puts
  // lightness third; the others put it first.
  const hsl = value.match(
    /^hsla?\(\s*[\d.]+(?:deg|rad|grad|turn)?[\s,]+[\d.]+%?[\s,]+([\d.]+)(%?)/i,
  );
  const lightnessFirst = value.match(
    /^(?:oklch|oklab|lch|lab)\(\s*([\d.]+)(%?)/i,
  );
  const lightness = hsl ?? lightnessFirst;
  if (lightness) {
    const raw = Number(lightness[1]);
    const normalized =
      lightness[2] === "%" ? raw / 100 : raw > 1 ? raw / 100 : raw;
    const channel = Math.round(Math.min(Math.max(normalized, 0), 1) * 255);
    return [channel, channel, channel];
  }
  return null;
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

  if (NAMED_DARK.has(normalized)) return true;
  if (NAMED_LIGHT.has(normalized)) return false;
  if (DARK_TAILWIND_BACKGROUND.test(normalized)) return true;
  if (LIGHT_TAILWIND_BACKGROUND.test(normalized)) return false;

  // A gradient is dark only when every stop it declares is dark; a light stop
  // anywhere means text sized for a dark canvas will collide with it.
  const stops = [
    ...normalized.matchAll(/#[\da-f]{3,8}\b/gi),
    ...normalized.matchAll(/rgba?\([^)]*\)/gi),
    ...normalized.matchAll(/(?:hsla?|oklch|oklab|lch|lab)\([^)]*\)/gi),
  ].map((match) => match[0]);

  if (stops.length === 0) return null;

  let dark = 0;
  let readable = 0;
  for (const stop of stops) {
    const channels = stop.startsWith("#")
      ? hexChannels(stop)
      : functionalChannels(stop);
    if (!channels) continue;
    readable += 1;
    const [r, g, b] = channels;
    if (r * 0.299 + g * 0.587 + b * 0.114 < 128) dark += 1;
  }

  if (readable === 0) return null;
  return dark === readable;
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
