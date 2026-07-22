import { clampChroma, converter, parse } from "culori";

export const DESIGN_SYSTEM_COLOR_TOKENS = [
  "background",
  "foreground",
  "border",
  "input",
  "ring",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "destructive",
  "destructive-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "popover",
  "popover-foreground",
  "card",
  "card-foreground",
  "sidebar-background",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
] as const;

export type DesignSystemColorToken =
  (typeof DESIGN_SYSTEM_COLOR_TOKENS)[number];
export type DesignSystemColorPalette = Partial<
  Record<DesignSystemColorToken, string>
>;

export interface DesignSystemTheme {
  colors: {
    light: DesignSystemColorPalette;
    /** Dark mode falls back token-by-token to the light palette. */
    dark?: DesignSystemColorPalette;
  };
  radius?: string;
  typography?: {
    fontFamily?: string;
    monoFontFamily?: string;
    baseFontSize?: string;
  };
  elevation?: {
    low?: string;
    medium?: string;
    high?: string;
  };
}

export interface NormalizedDesignSystemTheme {
  light: Record<string, string>;
  dark: Record<string, string>;
}

const toHsl = converter("hsl");

function round(value: number): string {
  return Number(value.toFixed(3)).toString();
}

export function normalizeDesignSystemColor(value: string): string {
  const parsed = parse(value);
  const color = parsed ? toHsl(clampChroma(parsed, "oklch")) : undefined;
  if (!color) {
    throw new Error(`Unsupported design system color: ${value}`);
  }

  const hue = color.h ?? 0;
  const base = `${round(hue)} ${round(color.s * 100)}% ${round(color.l * 100)}%`;
  return color.alpha !== undefined && color.alpha < 1
    ? `${base} / ${round(color.alpha)}`
    : base;
}

function normalizePalette(
  palette: DesignSystemColorPalette,
): Record<string, string> {
  return Object.fromEntries(
    DESIGN_SYSTEM_COLOR_TOKENS.flatMap((token) => {
      const value = palette[token];
      if (value === undefined) return [];
      try {
        return [[`--${token}`, normalizeDesignSystemColor(value)]];
      } catch (error) {
        throw new Error(
          `Invalid design system color for "${token}": ${value}`,
          { cause: error },
        );
      }
    }),
  );
}

export function normalizeDesignSystemTheme(
  theme: DesignSystemTheme,
): NormalizedDesignSystemTheme {
  const light = normalizePalette(theme.colors.light);
  const dark = {
    ...light,
    ...normalizePalette(theme.colors.dark ?? {}),
  };

  const shared: Record<string, string | undefined> = {
    "--radius": theme.radius,
    "--font-family": theme.typography?.fontFamily,
    "--font-mono": theme.typography?.monoFontFamily,
    "--base-font-size": theme.typography?.baseFontSize,
    "--shadow-low": theme.elevation?.low,
    "--shadow-medium": theme.elevation?.medium,
    "--shadow-high": theme.elevation?.high,
  };
  for (const [name, value] of Object.entries(shared)) {
    if (value !== undefined) {
      light[name] = value;
      dark[name] = value;
    }
  }

  return { light, dark };
}

function renderDeclarations(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
}

export function renderDesignSystemThemeCss(theme: DesignSystemTheme): string {
  const normalized = normalizeDesignSystemTheme(theme);
  return `:root:root {\n${renderDeclarations(normalized.light)}\n}\n\n:root.dark {\n${renderDeclarations(normalized.dark)}\n}\n`;
}

export function defineTheme<const Theme extends DesignSystemTheme>(
  theme: Theme,
): Theme {
  return theme;
}
