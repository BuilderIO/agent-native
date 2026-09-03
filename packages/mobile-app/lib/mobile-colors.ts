import { useCSSVariable, useUniwind } from "uniwind";

import type { MobileTheme } from "./mobile-theme";

export interface MobileThemeColors {
  theme: MobileTheme;
  background: string;
  foreground: string;
  card: string;
  border: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  muted: string;
  mutedForeground: string;
  destructive: string;
  errorBg: string;
  errorBorder: string;
  successBg: string;
  successBorder: string;
  warningYellowBg: string;
  warningYellowBorder: string;
  accentBlue: string;
  accentGreen: string;
  accentOrange: string;
  errorText: string;
  successText: string;
  warningYellowText: string;
}

function asColor(value: string | number | undefined): string {
  return typeof value === "string" ? value : "transparent";
}

/** Reads resolved Uniwind tokens for native APIs that cannot use className. */
export function useMobileThemeColors(): MobileThemeColors {
  const { theme } = useUniwind();
  const [
    background,
    foreground,
    card,
    border,
    primary,
    primaryForeground,
    secondary,
    muted,
    mutedForeground,
    destructive,
    errorBg,
    errorBorder,
    successBg,
    successBorder,
    warningYellowBg,
    warningYellowBorder,
    accentBlue,
    accentGreen,
    accentOrange,
    errorText,
    successText,
    warningYellowText,
  ] = useCSSVariable([
    "--color-background",
    "--color-foreground",
    "--color-card",
    "--color-border",
    "--color-primary",
    "--color-primary-foreground",
    "--color-secondary",
    "--color-muted",
    "--color-muted-foreground",
    "--color-destructive",
    "--color-error-bg",
    "--color-error-border",
    "--color-success-bg",
    "--color-success-border",
    "--color-warning-yellow-bg",
    "--color-warning-yellow-border",
    "--color-accent-blue",
    "--color-accent-green",
    "--color-accent-orange",
    "--color-error-text",
    "--color-success-text",
    "--color-warning-yellow-text",
  ]);

  return {
    theme,
    background: asColor(background),
    foreground: asColor(foreground),
    card: asColor(card),
    border: asColor(border),
    primary: asColor(primary),
    primaryForeground: asColor(primaryForeground),
    secondary: asColor(secondary),
    muted: asColor(muted),
    mutedForeground: asColor(mutedForeground),
    destructive: asColor(destructive),
    errorBg: asColor(errorBg),
    errorBorder: asColor(errorBorder),
    successBg: asColor(successBg),
    successBorder: asColor(successBorder),
    warningYellowBg: asColor(warningYellowBg),
    warningYellowBorder: asColor(warningYellowBorder),
    accentBlue: asColor(accentBlue),
    accentGreen: asColor(accentGreen),
    accentOrange: asColor(accentOrange),
    errorText: asColor(errorText),
    successText: asColor(successText),
    warningYellowText: asColor(warningYellowText),
  };
}
