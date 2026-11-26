import { tokenThemeValues } from "../tokens/source.js";
import { baselineTheme } from "./baseline.js";
import { shadcnTheme, themeProperties } from "./shadcn.js";
import type { ThemeDefinition } from "./types.js";

export { APPEARANCES } from "./appearances.js";
export { SHADCN_SLOTS, shadcn, shadcnTheme } from "./shadcn.js";
export type { ThemeDefinition, ThemeValues } from "./types.js";
export { baselineTheme };

const AGENT_NATIVE_EXTRAS = {
  base: {
    "font-sans": "var(--font-family-sans)",
    "font-wordmark": "var(--font-family-wordmark)",
    "radius-xl": "var(--radius-5)",
    "shadow-composer": "0 8px 15px var(--shadow-tint-a1)",
    "agent-kit-composer-radius": "var(--radius-5)",
    "agent-kit-composer-elevation": "var(--shadow-composer)",
  },
  dark: {
    "shadow-composer": "0 8px 30px var(--shadow-tint-a2)",
    "agent-kit-composer-elevation": "var(--shadow-composer)",
  },
};

const agentNativeTokens = tokenThemeValues("agent-native", "light");

/** The umbrella look every app can switch to; applied with no `data-app-theme`. */
export const agentNativeTheme: ThemeDefinition = {
  ...shadcnTheme({
    name: "agent-native",
    label: "Agent-Native",
    isDefault: true,
    values: agentNativeTokens,
  }),
  scopedOnly: {
    base: themeProperties(
      "agent-native",
      AGENT_NATIVE_EXTRAS.base,
      agentNativeTokens.base,
    ),
    dark: themeProperties("agent-native", AGENT_NATIVE_EXTRAS.dark, {
      ...agentNativeTokens.base,
      ...agentNativeTokens.dark,
    }),
  },
};

const APPS = [
  ["analytics", "Analytics", "dark"],
  ["assets", "Assets", "light"],
  ["brain", "Brain", "light"],
  ["calendar", "Calendar", "light"],
  ["chat", "Chat", "light"],
  ["clips", "Clips", "light"],
  ["content", "Content", "light"],
  ["crm", "CRM", "light"],
  ["design", "Design", "light"],
  ["desktop", "Desktop", "light"],
  ["dispatch", "Dispatch", "light"],
  ["docs", "Docs", "light"],
  ["factory", "Factory", "light"],
  ["forms", "Forms", "light"],
  ["mail", "Mail", "light"],
  ["plan", "Plan", "light"],
  ["slides", "Slides", "dark"],
  ["tasks", "Tasks", "light"],
] as const satisfies ReadonlyArray<readonly [string, string, "light" | "dark"]>;

export type AppThemeName =
  | (typeof APPS)[number][0]
  | "agent-native"
  | "baseline";

/** One theme per app, named for the app; their values are their token files. */
export const APP_THEMES: readonly ThemeDefinition[] = APPS.map(
  ([name, label, appearance]) =>
    shadcnTheme({ name, label, values: tokenThemeValues(name, appearance) }),
);

export const THEMES: readonly ThemeDefinition[] = [
  agentNativeTheme,
  ...APP_THEMES,
  baselineTheme,
];

export function getTheme(name: string): ThemeDefinition | undefined {
  return THEMES.find((theme) => theme.name === name);
}
