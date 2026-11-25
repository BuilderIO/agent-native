import { useTheme } from "next-themes";
import { createContext, useContext } from "react";

export const THEME_CHOICES = ["system", "light", "dark"] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return THEME_CHOICES.some((choice) => choice === value);
}

/**
 * Present while a theme sent by a host (the desktop app, an embedding page) is
 * on screen. next-themes then holds the host's theme, so the person's own
 * choice is kept here, along with a way to put it back on screen.
 */
export interface HostedThemeChoice {
  savedChoice: string | undefined;
  release: () => void;
}

export const HostedThemeChoiceContext = createContext<HostedThemeChoice | null>(
  null,
);

/**
 * The person's own System, Light or Dark choice for this app. A host's theme
 * changes what's on screen but never this value; choosing one puts it on
 * screen and saves it.
 */
export function useThemeChoice(): {
  choice: ThemeChoice | null;
  setChoice: (choice: ThemeChoice) => void;
} {
  const { theme, setTheme } = useTheme();
  const hosted = useContext(HostedThemeChoiceContext);
  const current = hosted ? hosted.savedChoice : theme;
  return {
    choice: isThemeChoice(current) ? current : null,
    setChoice: (choice) => {
      hosted?.release();
      setTheme(choice);
    },
  };
}
