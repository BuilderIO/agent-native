/** Our extension: the exact HSL text a color came from, so it round-trips without drift. */
export const EXTENSION = "com.agent-native";

export interface DtcgColor {
  colorSpace: "srgb";
  components: [number, number, number];
  alpha: number;
  hex: string;
}

export type DtcgType = "color" | "number" | "string";

export interface DtcgToken {
  $type: DtcgType;
  $value: DtcgColor | number | string;
  $description?: string;
  $extensions?: Record<string, unknown>;
}

export interface DtcgGroup {
  [name: string]: DtcgToken | DtcgGroup;
}

export class TokenError extends Error {
  constructor(
    readonly file: string,
    readonly tokenPath: string,
    problem: string,
  ) {
    super(`${file}: ${tokenPath} ${problem}`);
    this.name = "TokenError";
  }
}

function isToken(node: unknown): node is DtcgToken {
  return typeof node === "object" && node !== null && "$value" in node;
}

/** Every token in a file by its dotted path (`font.size.1`). */
export function flattenTokens(
  group: unknown,
  file: string,
  prefix = "",
): Map<string, DtcgToken> {
  const tokens = new Map<string, DtcgToken>();
  if (typeof group !== "object" || group === null || Array.isArray(group)) {
    throw new TokenError(file, prefix || "(root)", "is not a token group");
  }
  for (const [name, node] of Object.entries(group)) {
    if (name.startsWith("$")) continue;
    const tokenPath = prefix ? `${prefix}.${name}` : name;
    if (isToken(node)) tokens.set(tokenPath, node);
    else {
      for (const [key, token] of flattenTokens(node, file, tokenPath)) {
        tokens.set(key, token);
      }
    }
  }
  return tokens;
}

/** A token group from tokens by dotted path: the inverse of `flattenTokens`. */
export function unflattenTokens(
  tokens: ReadonlyMap<string, DtcgToken>,
): DtcgGroup {
  const root: DtcgGroup = {};
  for (const [tokenPath, token] of tokens) {
    const names = tokenPath.split(".");
    let group = root;
    for (const name of names.slice(0, -1)) {
      const next = group[name];
      if (next === undefined) {
        const created: DtcgGroup = {};
        group[name] = created;
        group = created;
      } else if (isToken(next)) {
        throw new Error(`${tokenPath} nests under the token ${name}`);
      } else {
        group = next;
      }
    }
    group[names.at(-1) ?? tokenPath] = token;
  }
  return root;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** `#rrggbb` from sRGB components in 0..1. */
export function componentsToHex(components: readonly number[]): string {
  return `#${components
    .map((value) =>
      Math.round(Math.min(1, Math.max(0, value)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** sRGB components in 0..1 from `#rrggbb`. */
export function hexToComponents(hex: string): [number, number, number] {
  if (!HEX.test(hex)) throw new Error(`Not a #rrggbb color: ${hex}`);
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function hslToComponents(
  hue: number,
  saturation: number,
  lightness: number,
): [number, number, number] {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [channel(0), channel(8), channel(4)];
}

const HSL_TRIPLET = /^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/;

/** The color token for a shadcn-style `H S% L%` triplet, keeping the text exactly. */
export function hslColorToken(triplet: string): DtcgToken {
  const match = HSL_TRIPLET.exec(triplet);
  if (!match) throw new Error(`Not an "H S% L%" triplet: ${triplet}`);
  const components = hslToComponents(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  );
  return colorToken(components, triplet);
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

export function colorToken(
  components: readonly number[],
  hsl?: string,
): DtcgToken {
  const [r = 0, g = 0, b = 0] = components;
  return {
    $type: "color",
    $value: {
      colorSpace: "srgb",
      components: [round6(r), round6(g), round6(b)],
      alpha: 1,
      hex: componentsToHex([r, g, b]),
    },
    ...(hsl === undefined ? {} : { $extensions: { [EXTENSION]: { hsl } } }),
  };
}

/** `H S% L%` for sRGB components, at the precision a hand-written triplet uses. */
export function componentsToHslTriplet(components: readonly number[]): string {
  const [r = 0, g = 0, b = 0] = components;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  let hue = 0;
  let saturation = 0;
  if (max !== min) {
    const delta = max - min;
    saturation =
      lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    hue =
      max === r
        ? (g - b) / delta + (g < b ? 6 : 0)
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
    hue *= 60;
  }
  const fixed = (value: number) => String(Math.round(value * 10) / 10);
  return `${fixed(hue)} ${fixed(saturation * 100)}% ${fixed(lightness * 100)}%`;
}

/**
 * The sRGB components of a color value: our object form, or a bare hex
 * string, which some tools write instead.
 */
export function colorComponents(
  value: unknown,
  file: string,
  tokenPath: string,
): [number, number, number] {
  if (typeof value === "string") {
    if (!HEX.test(value)) {
      throw new TokenError(file, tokenPath, `is not a #rrggbb color: ${value}`);
    }
    return hexToComponents(value);
  }
  if (typeof value !== "object" || value === null) {
    throw new TokenError(file, tokenPath, "has no color value");
  }
  const color = value as Record<string, unknown>;
  if (color.alpha !== undefined && color.alpha !== 1) {
    throw new TokenError(
      file,
      tokenPath,
      "has an alpha; theme colors are opaque",
    );
  }
  if (
    color.colorSpace === "srgb" &&
    Array.isArray(color.components) &&
    color.components.length === 3 &&
    color.components.every(
      (c): c is number => typeof c === "number" && c >= 0 && c <= 1,
    )
  ) {
    const [r, g, b] = color.components as [number, number, number];
    return [r, g, b];
  }
  if (typeof color.hex === "string" && HEX.test(color.hex)) {
    return hexToComponents(color.hex);
  }
  throw new TokenError(
    file,
    tokenPath,
    "is not an sRGB color (colorSpace srgb with components, or hex)",
  );
}

/** Reads typed values from one file's tokens, throwing on anything missing or mistyped. */
export class TokenReader {
  private readonly tokens: Map<string, DtcgToken>;

  constructor(
    readonly file: string,
    group: unknown,
  ) {
    this.tokens = flattenTokens(group, file);
  }

  paths(): string[] {
    return [...this.tokens.keys()];
  }

  token(tokenPath: string, type: DtcgType): DtcgToken {
    const token = this.tokens.get(tokenPath);
    if (!token) throw new TokenError(this.file, tokenPath, "is missing");
    if (token.$type !== type) {
      throw new TokenError(
        this.file,
        tokenPath,
        `is a ${String(token.$type)}, expected a ${type}`,
      );
    }
    return token;
  }

  number(tokenPath: string): number {
    const value = this.token(tokenPath, "number").$value;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TokenError(this.file, tokenPath, "is not a finite number");
    }
    return value;
  }

  string(tokenPath: string): string {
    const value = this.token(tokenPath, "string").$value;
    if (typeof value !== "string" || value.trim() === "") {
      throw new TokenError(this.file, tokenPath, "is not a non-empty string");
    }
    return value;
  }

  /** A color as `#rrggbb`. */
  hex(tokenPath: string): string {
    return componentsToHex(
      colorComponents(
        this.token(tokenPath, "color").$value,
        this.file,
        tokenPath,
      ),
    );
  }

  /**
   * A color as an `H S% L%` triplet: the exact text it was written as, when
   * the recorded text still describes the same color, else derived from it.
   */
  hslTriplet(tokenPath: string): string {
    const token = this.token(tokenPath, "color");
    const components = colorComponents(token.$value, this.file, tokenPath);
    const recorded = (
      token.$extensions?.[EXTENSION] as { hsl?: unknown } | undefined
    )?.hsl;
    if (typeof recorded === "string" && HSL_TRIPLET.test(recorded)) {
      const recordedHex = componentsToHex(
        colorComponents(hslColorToken(recorded).$value, this.file, tokenPath),
      );
      if (recordedHex === componentsToHex(components)) return recorded;
    }
    return componentsToHslTriplet(components);
  }
}
