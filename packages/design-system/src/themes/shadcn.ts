import Color from "colorjs.io";

import { TAILWIND_SHADOWS } from "../tokens/base.js";
import { createPalette, type PaletteInput } from "../tokens/palette.js";
import type { TokenMap } from "../tokens/primitives.js";
import { FOCUS_RING_TOKENS, STANDARD_ROLES } from "../tokens/roles.js";
import { shadcn } from "./reference.js";
import type { ThemeDefinition, ThemeValues } from "./types.js";

export { shadcn };

/**
 * The shadcn slots a palette theme fills. Themes write them out one way for
 * components not yet migrated; nothing in the design system reads them.
 */
export const SHADCN_SLOTS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "radius",
  "sidebar-background",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
] as const;

const SLOTS: ReadonlySet<string> = new Set(SHADCN_SLOTS);

const REFERENCE = /var\(--([a-z0-9-]+)(?:,\s*var\(--([a-z0-9-]+)\))?\)/g;

const own = (slot: string) => `--theme-${slot}`;

function resolve(
  themeName: string,
  tokens: TokenMap,
  values: Readonly<Record<string, string>>,
): TokenMap {
  const resolved: TokenMap = {};
  for (const [key, expression] of Object.entries(tokens)) {
    resolved[key as `--${string}`] = expression.replace(
      REFERENCE,
      (match, name: string, fallback: string | undefined) => {
        if (!SLOTS.has(name)) return match;
        const slot =
          name in values
            ? name
            : fallback !== undefined && fallback in values
              ? fallback
              : undefined;
        if (slot === undefined) {
          throw new Error(
            `Theme ${themeName} has no "${name}" for ${key}; add it to the theme's values`,
          );
        }
        return `var(${own(slot)})`;
      },
    );
  }
  return resolved;
}

const SHADCN_ROLES: TokenMap = {
  ...STANDARD_ROLES,

  "--surface-app": shadcn("background"),
  "--surface-nav": "hsl(var(--sidebar-background, var(--background)))",
  "--surface-canvas": shadcn("background"),
  "--surface-raised": shadcn("popover"),
  "--surface-sunken": shadcn("muted"),
  "--surface-overlay": shadcn("background", 0.45),
  "--surface-inverse": shadcn("foreground"),

  "--fg-default": shadcn("foreground"),
  "--fg-muted":
    "color-mix(in oklab, hsl(var(--muted-foreground)) 80%, hsl(var(--foreground)))",
  "--fg-subtle": shadcn("muted-foreground"),
  "--fg-disabled": "var(--gray-a8)",
  "--fg-on-brand": shadcn("primary-foreground"),
  "--fg-on-danger": shadcn("destructive-foreground"),
  "--fg-brand": "var(--brand-text)",
  "--fg-danger":
    "color-mix(in oklab, hsl(var(--destructive)) 60%, hsl(var(--foreground)))",
  "--fg-inverse": shadcn("background"),

  "--line-default": shadcn("border"),
  "--line-subtle": shadcn("border"),
  "--line-strong": shadcn("input"),
  "--line-focus": shadcn("ring"),

  "--fill-hover": shadcn("accent"),
  "--fill-pressed": shadcn("accent"),
  "--fill-selected": shadcn("accent"),
  "--fill-neutral": shadcn("secondary"),
  "--fill-neutral-hover": shadcn("secondary", 0.8),
  "--fill-field": shadcn("background"),
  "--fill-brand": shadcn("primary"),
  "--fill-brand-hover": shadcn("primary", 0.9),
  "--fill-brand-subtle": shadcn("primary", 0.1),
  "--fill-danger": "color-mix(in oklab, hsl(var(--destructive)) 74%, black)",
  "--fill-danger-hover":
    "color-mix(in oklab, hsl(var(--destructive)) 66%, black)",
  "--fill-danger-subtle": shadcn("destructive", 0.1),

  "--shadow-1": TAILWIND_SHADOWS.xs,
  "--shadow-2": TAILWIND_SHADOWS.sm,
  "--shadow-3": TAILWIND_SHADOWS.md,
  "--shadow-4": TAILWIND_SHADOWS.lg,
  "--shadow-5": TAILWIND_SHADOWS.xl,
  "--shadow-6": TAILWIND_SHADOWS["2xl"],
};

const SHADCN_TOKENS: TokenMap = {
  ...FOCUS_RING_TOKENS,
  "--shape-control": "calc(var(--radius) - 2px)",
  "--shape-popup": "calc(var(--radius) - 2px)",
  "--shape-card": "calc(var(--radius) + 4px)",
  "--shape-panel": "var(--radius)",
  "--shape-dialog": "var(--radius)",
  "--shape-pill": "var(--radius-full)",
};

function declarations(
  themeName: string,
  values: Readonly<Record<string, string>>,
): TokenMap {
  const tokens: TokenMap = {};
  for (const [name, value] of Object.entries(values)) {
    if (SLOTS.has(name)) {
      tokens[own(name) as `--${string}`] = value;
      tokens[`--${name}`] = `var(${own(name)})`;
    } else {
      tokens[`--${name}`] = value;
    }
  }
  return resolve(themeName, tokens, values);
}

/**
 * Properties a theme sets beyond its slots (`font-sans`, `shadow-composer`),
 * with slot references resolved to the theme's own values.
 */
export function themeProperties(
  themeName: string,
  properties: Readonly<Record<string, string>>,
  values: Readonly<Record<string, string>>,
): TokenMap {
  const tokens: TokenMap = {};
  for (const [name, value] of Object.entries(properties)) {
    tokens[`--${name}`] = value;
  }
  return resolve(themeName, tokens, values);
}

function themePalette(
  name: string,
  light: Readonly<Record<string, string>>,
  dark: Readonly<Record<string, string>>,
): ThemeDefinition["palette"] {
  const color = (values: Readonly<Record<string, string>>, slot: string) => {
    const value = values[slot];
    if (value === undefined) throw new Error(`Theme ${name} has no "${slot}"`);
    const channels = /^(-?[\d.]+) ([\d.]+)% ([\d.]+)%$/.exec(value.trim());
    if (!channels) {
      throw new Error(`Theme ${name}'s "${slot}" is not an H S% L% triplet`);
    }
    const [, hue, saturation, lightness] = channels.map(Number);
    return new Color("hsl", [hue ?? 0, saturation ?? 0, lightness ?? 0])
      .to("srgb")
      .toString({ format: "hex" });
  };
  const input = (values: Readonly<Record<string, string>>): PaletteInput => ({
    brand: color(values, "primary"),
    gray: color(values, "muted-foreground"),
    background: {
      light: color(light, "background"),
      dark: color(dark, "background"),
    },
    status: { danger: color(values, "destructive") },
  });
  return {
    light: createPalette(input(light)).light,
    dark: createPalette(input(dark)).dark,
  };
}

export function shadcnTheme({
  name,
  label,
  isDefault = false,
  values,
}: {
  name: string;
  label: string;
  isDefault?: boolean;
  values: ThemeValues;
}): ThemeDefinition {
  const dark = { ...values.base, ...values.dark };
  const light = { ...values.base, ...values.light };
  return {
    name,
    label,
    isDefault,
    base: {
      ...resolve(name, SHADCN_ROLES, values.base),
      ...declarations(name, values.base),
    },
    dark: {
      ...resolve(name, SHADCN_ROLES, dark),
      ...declarations(name, dark),
    },
    light: {
      ...resolve(name, SHADCN_ROLES, light),
      ...declarations(name, light),
    },
    tokens: resolve(name, SHADCN_TOKENS, values.base),
    palette: themePalette(name, light, dark),
    readsScales: false,
  };
}
