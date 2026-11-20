import * as RadixColors from "@radix-ui/colors";
import Color from "colorjs.io";

import { at } from "./at.js";
import { BASE_BY_APPEARANCE } from "./base.js";
import {
  type Appearance,
  generateRadixColors,
  RADIX_SCALE_NAMES,
  type RadixColorsOutput,
  type RadixScaleName,
  type Scale12,
} from "./color/radix-generator.js";
import type { TokenMap } from "./primitives.js";
import { PALETTE_DEFAULTS } from "./source.js";

export type StatusRole = "danger" | "warning" | "success" | "info";
export const STATUS_ROLES: readonly StatusRole[] = [
  "danger",
  "warning",
  "success",
  "info",
];

export interface PaletteInput {
  /** Any CSS color. Becomes the 12-step `--brand-*` scale. */
  brand: string;
  /** Any CSS color whose hue and chroma tint the `--gray-*` scale. */
  gray?: string;
  /** Page background per appearance. */
  background?: Partial<Record<Appearance, string>>;
  /** A Radix scale name (`"tomato"`) or any CSS color, per status role. */
  status?: Partial<Record<StatusRole, RadixScaleName | string>>;
}

export interface ResolvedPaletteInput {
  brand: string;
  gray: string;
  background: Record<Appearance, string>;
  status: Record<StatusRole, string>;
}

export interface AppearanceTokens {
  /** sRGB values every browser can paint. */
  srgb: TokenMap;
  /** Display-P3 overrides, applied only on wide-gamut screens. */
  p3: TokenMap;
  /** shadcn HSL triplets (`--primary: 240 5% 26%`) for unmigrated code. */
  legacy: TokenMap;
}

export interface Palette {
  input: ResolvedPaletteInput;
  light: AppearanceTokens;
  dark: AppearanceTokens;
}

/** From `files/palette.tokens.json`. */
export const DEFAULT_PALETTE_INPUT: ResolvedPaletteInput = PALETTE_DEFAULTS;

const radixPalettes = RadixColors as unknown as Record<
  string,
  Record<string, string>
>;

function isRadixScaleName(value: string): value is RadixScaleName {
  return (RADIX_SCALE_NAMES as readonly string[]).includes(value);
}

function statusSeed(value: string): string {
  if (!isRadixScaleName(value)) return value;
  const seed = radixPalettes[value]?.[`${value}9`];
  if (!seed) throw new Error(`Missing Radix step 9 for ${value}`);
  return seed;
}

export function resolvePaletteInput(input: PaletteInput): ResolvedPaletteInput {
  return {
    brand: input.brand,
    gray: input.gray ?? DEFAULT_PALETTE_INPUT.gray,
    background: {
      light: input.background?.light ?? DEFAULT_PALETTE_INPUT.background.light,
      dark: input.background?.dark ?? DEFAULT_PALETTE_INPUT.background.dark,
    },
    status: {
      danger: input.status?.danger ?? DEFAULT_PALETTE_INPUT.status.danger,
      warning: input.status?.warning ?? DEFAULT_PALETTE_INPUT.status.warning,
      success: input.status?.success ?? DEFAULT_PALETTE_INPUT.status.success,
      info: input.status?.info ?? DEFAULT_PALETTE_INPUT.status.info,
    },
  };
}

/**
 * Every color primitive for a brand, in both appearances: the brand, gray and
 * status scales (12 solid + 12 alpha steps each, plus contrast, surface,
 * indicator and track), the base surfaces, and the legacy shadcn triplets.
 * Throws on an unparseable color rather than falling back to a default.
 */
export function createPalette(input: PaletteInput): Palette {
  const resolved = resolvePaletteInput(input);
  return {
    input: resolved,
    light: appearanceTokens(resolved, "light"),
    dark: appearanceTokens(resolved, "dark"),
  };
}

function appearanceTokens(
  input: ResolvedPaletteInput,
  appearance: Appearance,
): AppearanceTokens {
  const background = input.background[appearance];
  const brand = generateRadixColors({
    appearance,
    accent: input.brand,
    gray: input.gray,
    background,
  });
  const srgb: TokenMap = {};
  const p3: TokenMap = {};

  writeScale(srgb, p3, "gray", {
    solid: brand.grayScale,
    alpha: brand.grayScaleAlpha,
    solidP3: brand.grayScaleWideGamut,
    alphaP3: brand.grayScaleAlphaWideGamut,
    contrast: "#ffffff",
    surface: brand.graySurface,
    surfaceP3: brand.graySurfaceWideGamut,
    background: brand.background,
  });
  writeAccent(srgb, p3, "brand", brand);

  const statusScales = {} as Record<StatusRole, RadixColorsOutput>;
  for (const role of STATUS_ROLES) {
    statusScales[role] = generateRadixColors({
      appearance,
      accent: statusSeed(input.status[role]),
      gray: input.gray,
      background,
    });
    writeAccent(srgb, p3, role, statusScales[role]);
  }

  const base = BASE_BY_APPEARANCE[appearance];
  srgb["--base-background"] = brand.background;
  srgb["--base-panel"] =
    appearance === "light" ? brand.background : brand.grayScale[1];
  srgb["--base-field"] = base.field;
  srgb["--base-overlay"] = base.overlay;
  base.shadowTint.forEach((value, index) => {
    srgb[`--shadow-tint-a${index + 1}`] = value;
  });

  return {
    srgb,
    p3,
    legacy: legacyTriplets(
      brand,
      srgb["--base-panel"],
      statusScales.danger,
      statusScales.success,
    ),
  };
}

interface ScaleSource {
  solid: Scale12;
  alpha: Scale12;
  solidP3: Scale12;
  alphaP3: Scale12;
  contrast: string;
  surface: string;
  surfaceP3: string;
  background: string;
}

function writeScale(
  srgb: TokenMap,
  p3: TokenMap,
  name: string,
  source: ScaleSource,
) {
  source.solid.forEach((value, index) => {
    srgb[`--${name}-${index + 1}`] = value;
    p3[`--${name}-${index + 1}`] = at(source.solidP3, index);
  });
  source.alpha.forEach((value, index) => {
    srgb[`--${name}-a${index + 1}`] = value;
    p3[`--${name}-a${index + 1}`] = at(source.alphaP3, index);
  });
  srgb[`--${name}-contrast`] = source.contrast;
  srgb[`--${name}-surface`] = source.surface;
  p3[`--${name}-surface`] = source.surfaceP3;
  writeReadableSteps(srgb, name, source);
}

const TEXT_CONTRAST = 4.5;

function stepsNearest(from: number): number[] {
  return Array.from({ length: 12 }, (_, index) => index + 1).sort(
    (a, b) => Math.abs(a - from) - Math.abs(b - from) || b - a,
  );
}

function readableStep(
  scale: Scale12,
  from: number,
  against: readonly string[],
  what: string,
): number {
  const step = stepsNearest(from).find((candidate) =>
    against.every(
      (background) =>
        new Color(at(scale, candidate - 1)).contrast(background, "WCAG21") >=
        TEXT_CONTRAST,
    ),
  );
  if (step === undefined) {
    throw new Error(`No step of this scale holds ${TEXT_CONTRAST}:1 ${what}`);
  }
  return step;
}

function readableTextMix(
  source: ScaleSource,
  backgrounds: readonly string[],
): number {
  const eleven = new Color(at(source.solid, 10));
  const twelve = new Color(at(source.solid, 11));
  for (let percent = 0; percent <= 100; percent += 5) {
    const text = eleven.mix(twelve, percent / 100, { space: "oklab" });
    if (
      backgrounds.every(
        (background) => text.contrast(background, "WCAG21") >= TEXT_CONTRAST,
      )
    ) {
      return percent;
    }
  }
  throw new Error(
    `Neither step 11 nor 12 holds ${TEXT_CONTRAST}:1 on its tints`,
  );
}

function over(alpha: string, background: string): string {
  const top = new Color(alpha).to("srgb");
  const bottom = new Color(background).to("srgb");
  const a = top.alpha;
  const coords = top.coords.map(
    (value, index) => (value ?? 0) * a + (bottom.coords[index] ?? 0) * (1 - a),
  ) as [number, number, number];
  return new Color("srgb", coords).toString({ format: "hex" });
}

function writeReadableSteps(srgb: TokenMap, name: string, source: ScaleSource) {
  const solid = readableStep(
    source.solid,
    9,
    [source.contrast],
    `under ${source.contrast} text`,
  );
  const text = readableTextMix(source, [
    source.background,
    over(at(source.alpha, 2), source.background),
    over(at(source.alpha, 3), source.background),
  ]);
  const toward = new Color(source.contrast).luminance > 0.5 ? "black" : "white";
  srgb[`--${name}-solid`] = `var(--${name}-${solid})`;
  srgb[`--${name}-solid-hover`] =
    `color-mix(in oklab, var(--${name}-${solid}) 88%, ${toward})`;
  srgb[`--${name}-text`] =
    text === 0
      ? `var(--${name}-11)`
      : `color-mix(in oklab, var(--${name}-11), var(--${name}-12) ${text}%)`;
}

function writeAccent(
  srgb: TokenMap,
  p3: TokenMap,
  name: string,
  colors: RadixColorsOutput,
) {
  writeScale(srgb, p3, name, {
    solid: colors.accentScale,
    alpha: colors.accentScaleAlpha,
    solidP3: colors.accentScaleWideGamut,
    alphaP3: colors.accentScaleAlphaWideGamut,
    contrast: colors.accentContrast,
    surface: colors.accentSurface,
    surfaceP3: colors.accentSurfaceWideGamut,
    background: colors.background,
  });
  srgb[`--${name}-indicator`] = colors.accentScale[8];
  srgb[`--${name}-track`] = colors.accentScale[8];
  p3[`--${name}-indicator`] = colors.accentScaleWideGamut[8];
  p3[`--${name}-track`] = colors.accentScaleWideGamut[8];
}

const toHsl = (value: string) => new Color(value).to("hsl");

function round(value: number): string {
  return Number(value.toFixed(3)).toString();
}

/** `H S% L%`, the format shadcn variables are consumed in (`hsl(var(--x) / a)`). */
export function toHslTriplet(value: string): string {
  const [hue, saturation, lightness] = toHsl(value).coords;
  return `${round(hue ?? 0)} ${round(saturation ?? 0)}% ${round(lightness ?? 0)}%`;
}

function legacyTriplets(
  colors: RadixColorsOutput,
  panel: string,
  danger: RadixColorsOutput,
  success: RadixColorsOutput,
): TokenMap {
  const gray = (step: number) => at(colors.grayScale, step - 1);
  const brand = (step: number) => at(colors.accentScale, step - 1);
  const values: TokenMap = {
    "--background": colors.background,
    "--foreground": gray(12),
    "--card": panel,
    "--card-foreground": gray(12),
    "--popover": panel,
    "--popover-foreground": gray(12),
    "--primary": brand(9),
    "--primary-foreground": colors.accentContrast,
    "--secondary": gray(3),
    "--secondary-foreground": gray(12),
    "--muted": gray(3),
    "--muted-foreground": gray(11),
    "--accent": gray(3),
    "--accent-foreground": gray(12),
    "--destructive": danger.accentScale[8],
    "--destructive-foreground": danger.accentContrast,
    "--border": gray(6),
    "--input": gray(7),
    "--ring": brand(8),
    "--sidebar-background": gray(2),
    "--sidebar-foreground": gray(11),
    "--sidebar-primary": brand(9),
    "--sidebar-primary-foreground": colors.accentContrast,
    "--sidebar-accent": gray(4),
    "--sidebar-accent-foreground": gray(12),
    "--sidebar-border": gray(6),
    "--sidebar-ring": brand(8),
    "--success": success.accentScale[8],
  };
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, toHslTriplet(value)]),
  ) as TokenMap;
}
