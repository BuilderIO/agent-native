import {
  FOUNDATIONS,
  TEXT_STYLE_DEFINITIONS,
  TEXT_STYLE_NAMES,
  type TextStyle,
  type TextStyleName,
  type TypeStep,
} from "./source.js";

export type { TextStyle, TextStyleName, TypeStep };
export { TEXT_STYLE_NAMES };

export type TokenName = `--${string}`;
export type TokenMap = Record<TokenName, string>;

/**
 * Control heights for xs, sm, md, lg. The same at every density: with a
 * 16px floor there is no smaller step, so shifting the scale for compact would
 * make two sizes identical. Density varies spacing instead. 28 and 36 are
 * deliberately absent.
 */
export const CONTROL_HEIGHTS: readonly number[] = FOUNDATIONS.controlHeights;

/** Glyph size per control size; the inset is (height - glyph) / 2. */
export const CONTROL_ICON_SIZES: readonly number[] =
  FOUNDATIONS.controlIconSizes;

/** `--size-1..8` for boxes that are not controls: avatars, thumbnails, rows. */
export const SIZE_RAMP: readonly number[] = FOUNDATIONS.sizeRamp;

/** Multiplied by `--radius-factor` into `--radius-1..6`. */
export const RADIUS_STEPS: readonly number[] = FOUNDATIONS.radiusSteps;

/** The type scale's steps, `--font-size-0..9` and their line heights and letter spacings. */
export const TYPE_RAMP: readonly TypeStep[] = FOUNDATIONS.typeRamp;

/** The named text styles, in the order the system lists them. */
export const TEXT_STYLES: readonly TextStyle[] = TEXT_STYLE_DEFINITIONS;

/** The declarations a text style sets, each reading a scale token. */
export function textStyleDeclarations(
  style: TextStyle,
): Readonly<Record<string, string>> {
  return {
    "font-family": `var(--font-family-${style.family})`,
    "font-size": `var(--font-size-${style.step})`,
    "line-height": `var(--line-height-${style.step})`,
    "letter-spacing": `var(--letter-spacing-${style.step})`,
    "font-weight": `var(--font-weight-${style.weight})`,
  };
}

export const FONT_WEIGHTS: Readonly<Record<string, number>> =
  FOUNDATIONS.fontWeights;

export const FONT_FAMILIES: Readonly<Record<string, string>> =
  FOUNDATIONS.fontFamilies;

export const MOTION = {
  "--duration-1": "100ms",
  "--duration-2": "150ms",
  "--duration-3": "250ms",
  "--duration-4": "400ms",
  "--ease-standard": "cubic-bezier(0.4, 0, 0.2, 1)",
  "--ease-enter": "cubic-bezier(0, 0, 0.2, 1)",
  "--ease-exit": "cubic-bezier(0.4, 0, 1, 1)",
} as const satisfies TokenMap;

/** Toolkit's stacking order: a menu opened from a dialog sits above it. */
export const LAYERS = {
  "--layer-drawer-backdrop": "250",
  "--layer-drawer": "250",
  "--layer-dialog-backdrop": "270",
  "--layer-dialog": "280",
  "--layer-drawer-over-dialog-backdrop": "284",
  "--layer-drawer-over-dialog": "285",
  "--layer-alert-dialog-backdrop": "340",
  "--layer-alert-dialog": "350",
  "--layer-popup": "360",
  "--layer-toast": "400",
  "--layer-tooltip": "500",
  "--layer-cursor": "510",
} as const satisfies TokenMap;

const px = (value: number) => `${value}px`;

export function staticPrimitives(): TokenMap {
  const tokens: TokenMap = {};
  SIZE_RAMP.forEach((value, index) => {
    tokens[`--size-${index + 1}`] = px(value);
  });
  RADIUS_STEPS.forEach((value, index) => {
    tokens[`--radius-${index + 1}`] =
      `calc(${px(value)} * var(--radius-factor))`;
  });
  tokens["--radius-full"] = "9999px";
  for (const { step, size, lineHeight, letterSpacing } of TYPE_RAMP) {
    tokens[`--font-size-${step}`] = px(size);
    tokens[`--line-height-${step}`] = px(lineHeight);
    tokens[`--letter-spacing-${step}`] = letterSpacing;
  }
  for (const [name, weight] of Object.entries(FONT_WEIGHTS)) {
    tokens[`--font-weight-${name}`] = String(weight);
  }
  for (const [name, family] of Object.entries(FONT_FAMILIES)) {
    tokens[`--font-family-${name}`] = family;
  }
  return { ...tokens, ...MOTION, ...LAYERS };
}
