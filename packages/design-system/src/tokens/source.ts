import { at } from "./at.js";
import { COMPONENTS_FILE, readSwitchComponent } from "./component-inputs.js";
import { flattenTokens, TokenError, TokenReader } from "./dtcg.js";
import componentsFile from "./files/components.tokens.json" with { type: "json" };
import foundationsFile from "./files/foundations.tokens.json" with { type: "json" };
import paletteFile from "./files/palette.tokens.json" with { type: "json" };
import textStylesFile from "./files/text-styles.tokens.json" with { type: "json" };
import agentNativeDark from "./files/themes/agent-native.dark.tokens.json" with { type: "json" };
import agentNativeLight from "./files/themes/agent-native.light.tokens.json" with { type: "json" };
import analyticsDark from "./files/themes/analytics.dark.tokens.json" with { type: "json" };
import analyticsLight from "./files/themes/analytics.light.tokens.json" with { type: "json" };
import assetsDark from "./files/themes/assets.dark.tokens.json" with { type: "json" };
import assetsLight from "./files/themes/assets.light.tokens.json" with { type: "json" };
import brainDark from "./files/themes/brain.dark.tokens.json" with { type: "json" };
import brainLight from "./files/themes/brain.light.tokens.json" with { type: "json" };
import calendarDark from "./files/themes/calendar.dark.tokens.json" with { type: "json" };
import calendarLight from "./files/themes/calendar.light.tokens.json" with { type: "json" };
import chatDark from "./files/themes/chat.dark.tokens.json" with { type: "json" };
import chatLight from "./files/themes/chat.light.tokens.json" with { type: "json" };
import clipsDark from "./files/themes/clips.dark.tokens.json" with { type: "json" };
import clipsLight from "./files/themes/clips.light.tokens.json" with { type: "json" };
import contentDark from "./files/themes/content.dark.tokens.json" with { type: "json" };
import contentLight from "./files/themes/content.light.tokens.json" with { type: "json" };
import crmDark from "./files/themes/crm.dark.tokens.json" with { type: "json" };
import crmLight from "./files/themes/crm.light.tokens.json" with { type: "json" };
import designDark from "./files/themes/design.dark.tokens.json" with { type: "json" };
import designLight from "./files/themes/design.light.tokens.json" with { type: "json" };
import desktopDark from "./files/themes/desktop.dark.tokens.json" with { type: "json" };
import desktopLight from "./files/themes/desktop.light.tokens.json" with { type: "json" };
import dispatchDark from "./files/themes/dispatch.dark.tokens.json" with { type: "json" };
import dispatchLight from "./files/themes/dispatch.light.tokens.json" with { type: "json" };
import docsDark from "./files/themes/docs.dark.tokens.json" with { type: "json" };
import docsLight from "./files/themes/docs.light.tokens.json" with { type: "json" };
import factoryDark from "./files/themes/factory.dark.tokens.json" with { type: "json" };
import factoryLight from "./files/themes/factory.light.tokens.json" with { type: "json" };
import formsDark from "./files/themes/forms.dark.tokens.json" with { type: "json" };
import formsLight from "./files/themes/forms.light.tokens.json" with { type: "json" };
import mailDark from "./files/themes/mail.dark.tokens.json" with { type: "json" };
import mailLight from "./files/themes/mail.light.tokens.json" with { type: "json" };
import planDark from "./files/themes/plan.dark.tokens.json" with { type: "json" };
import planLight from "./files/themes/plan.light.tokens.json" with { type: "json" };
import slidesDark from "./files/themes/slides.dark.tokens.json" with { type: "json" };
import slidesLight from "./files/themes/slides.light.tokens.json" with { type: "json" };
import tasksDark from "./files/themes/tasks.dark.tokens.json" with { type: "json" };
import tasksLight from "./files/themes/tasks.light.tokens.json" with { type: "json" };

/** Every token file by its path under `files/`, as parsed JSON. */
export type TokenFiles = Readonly<Record<string, unknown>>;

export const TOKEN_FILES: TokenFiles = {
  "foundations.tokens.json": foundationsFile,
  "palette.tokens.json": paletteFile,
  [COMPONENTS_FILE]: componentsFile,
  "text-styles.tokens.json": textStylesFile,
  "themes/agent-native.light.tokens.json": agentNativeLight,
  "themes/agent-native.dark.tokens.json": agentNativeDark,
  "themes/analytics.light.tokens.json": analyticsLight,
  "themes/analytics.dark.tokens.json": analyticsDark,
  "themes/assets.light.tokens.json": assetsLight,
  "themes/assets.dark.tokens.json": assetsDark,
  "themes/brain.light.tokens.json": brainLight,
  "themes/brain.dark.tokens.json": brainDark,
  "themes/calendar.light.tokens.json": calendarLight,
  "themes/calendar.dark.tokens.json": calendarDark,
  "themes/chat.light.tokens.json": chatLight,
  "themes/chat.dark.tokens.json": chatDark,
  "themes/clips.light.tokens.json": clipsLight,
  "themes/clips.dark.tokens.json": clipsDark,
  "themes/content.light.tokens.json": contentLight,
  "themes/content.dark.tokens.json": contentDark,
  "themes/crm.light.tokens.json": crmLight,
  "themes/crm.dark.tokens.json": crmDark,
  "themes/design.light.tokens.json": designLight,
  "themes/design.dark.tokens.json": designDark,
  "themes/desktop.light.tokens.json": desktopLight,
  "themes/desktop.dark.tokens.json": desktopDark,
  "themes/dispatch.light.tokens.json": dispatchLight,
  "themes/dispatch.dark.tokens.json": dispatchDark,
  "themes/docs.light.tokens.json": docsLight,
  "themes/docs.dark.tokens.json": docsDark,
  "themes/factory.light.tokens.json": factoryLight,
  "themes/factory.dark.tokens.json": factoryDark,
  "themes/forms.light.tokens.json": formsLight,
  "themes/forms.dark.tokens.json": formsDark,
  "themes/mail.light.tokens.json": mailLight,
  "themes/mail.dark.tokens.json": mailDark,
  "themes/plan.light.tokens.json": planLight,
  "themes/plan.dark.tokens.json": planDark,
  "themes/slides.light.tokens.json": slidesLight,
  "themes/slides.dark.tokens.json": slidesDark,
  "themes/tasks.light.tokens.json": tasksLight,
  "themes/tasks.dark.tokens.json": tasksDark,
};

export const FOUNDATIONS_FILE = "foundations.tokens.json";
export const PALETTE_FILE = "palette.tokens.json";
export const TEXT_STYLES_FILE = "text-styles.tokens.json";
export const THEME_NAMES: readonly string[] = [
  "agent-native",
  "analytics",
  "assets",
  "brain",
  "calendar",
  "chat",
  "clips",
  "content",
  "crm",
  "design",
  "desktop",
  "dispatch",
  "docs",
  "factory",
  "forms",
  "mail",
  "plan",
  "slides",
  "tasks",
];

export type ThemeMode = "light" | "dark";
export const THEME_MODES: readonly ThemeMode[] = ["light", "dark"];

export const themeFile = (name: string, mode: ThemeMode) =>
  `themes/${name}.${mode}.tokens.json`;

const FONT_WEIGHT_NAMES = [
  "light",
  "regular",
  "medium",
  "semibold",
  "bold",
] as const;
const FONT_FAMILY_NAMES = ["sans", "heading", "mono", "wordmark"] as const;

type TextStyleGroup = (typeof textStylesFile)["text-style"];

/** A text style's name, from the keys of `text-styles.tokens.json`. */
export type TextStyleName = keyof TextStyleGroup;

function isTextStyleName(name: string): name is TextStyleName {
  return Object.hasOwn(textStylesFile["text-style"], name);
}

/** Each text style's name, in the order the file lists them. */
export const TEXT_STYLE_NAMES: readonly TextStyleName[] = Object.keys(
  textStylesFile["text-style"],
).filter(isTextStyleName);

export type FontWeightName = (typeof FONT_WEIGHT_NAMES)[number];
export type FontFamilyName = (typeof FONT_FAMILY_NAMES)[number];

/**
 * A named text style: one step of the type scale (its size, line height and
 * letter spacing together), a weight and a family. It is what a Figma text
 * style and a `type-*` utility apply.
 */
export interface TextStyle {
  readonly name: TextStyleName;
  readonly description: string;
  readonly step: number;
  readonly weight: FontWeightName;
  readonly family: FontFamilyName;
}

/** The type scale starts at step 0, the 10px step below the 12px UI base. */
export const TYPE_FIRST_STEP = 0;

/** One step of the type scale, as `--font-size-N` and its pairs set it. */
export interface TypeStep {
  readonly step: number;
  readonly size: number;
  readonly lineHeight: number;
  readonly letterSpacing: string;
}

function steps(reader: TokenReader, group: string, first = 1): number[] {
  const numbers = reader
    .paths()
    .filter((tokenPath) => tokenPath.startsWith(`${group}.`))
    .map((tokenPath) => Number(tokenPath.slice(group.length + 1)))
    .sort((a, b) => a - b);
  numbers.forEach((step, index) => {
    if (step !== index + first) {
      throw new TokenError(
        reader.file,
        `${group}.${index + first}`,
        "is missing",
      );
    }
  });
  return numbers.map((step) => reader.number(`${group}.${step}`));
}

function file(files: TokenFiles, path: string): unknown {
  if (!(path in files)) throw new TokenError(path, "(file)", "is missing");
  return files[path];
}

function readFoundations(files: TokenFiles) {
  const foundations = new TokenReader(
    FOUNDATIONS_FILE,
    file(files, FOUNDATIONS_FILE),
  );
  const typeSizes = steps(foundations, "font.size", TYPE_FIRST_STEP);
  const lineHeights = steps(foundations, "font.line-height", TYPE_FIRST_STEP);
  const letterSpacings = steps(
    foundations,
    "font.letter-spacing",
    TYPE_FIRST_STEP,
  );
  if (
    lineHeights.length !== typeSizes.length ||
    letterSpacings.length !== typeSizes.length
  ) {
    throw new TokenError(
      FOUNDATIONS_FILE,
      "font",
      "has steps of different lengths",
    );
  }
  return {
    controlHeights: steps(foundations, "size.control"),
    controlIconSizes: steps(foundations, "size.control-icon"),
    sizeRamp: steps(foundations, "size.box"),
    radiusSteps: steps(foundations, "radius"),
    typeRamp: typeSizes.map(
      (size, index): TypeStep => ({
        step: index + TYPE_FIRST_STEP,
        size,
        lineHeight: at(lineHeights, index),
        letterSpacing: `${at(letterSpacings, index)}em`,
      }),
    ),
    fontWeights: Object.fromEntries(
      FONT_WEIGHT_NAMES.map((name) => [
        name,
        foundations.number(`font.weight.${name}`),
      ]),
    ) as Record<(typeof FONT_WEIGHT_NAMES)[number], number>,
    fontFamilies: Object.fromEntries(
      FONT_FAMILY_NAMES.map((name) => [
        name,
        foundations.string(`font.family.${name}`),
      ]),
    ) as Record<(typeof FONT_FAMILY_NAMES)[number], string>,
  };
}

const TEXT_STYLE_PREFIX = "text-style.";
const TEXT_STYLE_PARTS = [
  ["fontSize", "size"],
  ["lineHeight", "line-height"],
  ["letterSpacing", "letter-spacing"],
] as const;

function isOneOf<T extends string>(
  values: readonly T[],
  value: string,
): value is T {
  return values.some((candidate) => candidate === value);
}

function readTextStyles(
  files: TokenFiles,
  steps: ReadonlySet<number>,
): TextStyle[] {
  const tokens = flattenTokens(file(files, TEXT_STYLES_FILE), TEXT_STYLES_FILE);
  const styles: TextStyle[] = [];
  for (const [tokenPath, token] of tokens) {
    const fail: (problem: string) => never = (problem) => {
      throw new TokenError(TEXT_STYLES_FILE, tokenPath, problem);
    };
    if (!tokenPath.startsWith(TEXT_STYLE_PREFIX)) fail("is not a text-style.*");
    const name = tokenPath.slice(TEXT_STYLE_PREFIX.length);
    if (!isTextStyleName(name))
      fail("is not a style text-styles.tokens.json names");
    if (String(token.$type) !== "typography") fail("is not a typography token");
    const description = token.$description ?? "";
    if (description.trim() === "") fail("has no $description");
    const value: unknown = token.$value;
    if (typeof value !== "object" || value === null) fail("has no value");
    const fields = new Map(Object.entries(value));
    const alias = (key: string, group: string): string => {
      const raw = fields.get(key);
      const match =
        typeof raw === "string"
          ? new RegExp(`^\\{font\\.${group}\\.([a-z0-9-]+)\\}$`).exec(raw)
          : null;
      const target = match?.at(1);
      return target ?? fail(`${key} is not an alias of a font.${group} token`);
    };
    const [first, ...rest] = TEXT_STYLE_PARTS.map(([key, group]) =>
      Number(alias(key, group)),
    );
    if (first === undefined || !steps.has(first)) {
      fail("fontSize is not a step of the type scale");
    }
    if (rest.some((step) => step !== first)) {
      fail(
        "sets its size, line height and letter spacing from different steps",
      );
    }
    const weight = alias("fontWeight", "weight");
    const family = alias("fontFamily", "family");
    if (!isOneOf(FONT_WEIGHT_NAMES, weight))
      fail(`fontWeight ${weight} is not a weight`);
    if (!isOneOf(FONT_FAMILY_NAMES, family))
      fail(`fontFamily ${family} is not a family`);
    styles.push({ name, description, step: first, weight, family });
  }
  if (styles.length === 0) {
    throw new TokenError(TEXT_STYLES_FILE, "text-style", "has no text styles");
  }
  return styles;
}

function readPalette(files: TokenFiles) {
  const palette = new TokenReader(PALETTE_FILE, file(files, PALETTE_FILE));
  return {
    brand: palette.hex("brand"),
    gray: palette.hex("gray"),
    background: {
      light: palette.hex("background.light"),
      dark: palette.hex("background.dark"),
    },
    status: {
      danger: palette.string("status.danger"),
      warning: palette.string("status.warning"),
      success: palette.string("status.success"),
      info: palette.string("status.info"),
    },
  };
}

function readThemeMode(
  files: TokenFiles,
  name: string,
  mode: ThemeMode,
): Record<string, string> {
  const path = themeFile(name, mode);
  const reader = new TokenReader(path, file(files, path));
  const values: Record<string, string> = {};
  for (const tokenPath of reader.paths()) {
    if (tokenPath.startsWith("color.")) {
      values[tokenPath.slice("color.".length)] = reader.hslTriplet(tokenPath);
    } else if (tokenPath === "radius") {
      values.radius = `${reader.number("radius") / 16}rem`;
    } else {
      throw new TokenError(
        path,
        tokenPath,
        "is not a theme value (color.* or radius)",
      );
    }
  }
  return values;
}

/**
 * Everything code reads from a set of token files. Throws a `TokenError` on
 * the first file that is missing a token or holds one of the wrong shape.
 */
export function readTokenFiles(files: TokenFiles) {
  const foundations = readFoundations(files);
  return {
    foundations,
    switchCssInputs: readSwitchComponent(file(files, COMPONENTS_FILE)).inputs,
    textStyles: readTextStyles(
      files,
      new Set(foundations.typeRamp.map(({ step }) => step)),
    ),
    palette: readPalette(files),
    themes: Object.fromEntries(
      THEME_NAMES.map((name) => [
        name,
        {
          light: readThemeMode(files, name, "light"),
          dark: readThemeMode(files, name, "dark"),
        },
      ]),
    ) as Record<string, Record<ThemeMode, Record<string, string>>>,
  };
}

const tokens = readTokenFiles(TOKEN_FILES);

export const FOUNDATIONS = tokens.foundations;
export const TEXT_STYLE_DEFINITIONS = tokens.textStyles;
export const PALETTE_DEFAULTS = tokens.palette;

/**
 * A theme's values from its light and dark token files. The appearance it
 * renders with no class is `base`; the other carries only what differs.
 */
export function tokenThemeValues(
  name: string,
  defaultAppearance: ThemeMode,
): {
  base: Record<string, string>;
  dark?: Record<string, string>;
  light?: Record<string, string>;
} {
  const modes = tokens.themes[name];
  if (!modes) throw new Error(`No token files for theme ${name}`);
  const base = modes[defaultAppearance];
  const other = modes[defaultAppearance === "light" ? "dark" : "light"];
  const differs = Object.fromEntries(
    Object.entries(other).filter(([key, value]) => base[key] !== value),
  );
  return defaultAppearance === "light"
    ? { base, dark: differs }
    : { base, light: differs };
}
