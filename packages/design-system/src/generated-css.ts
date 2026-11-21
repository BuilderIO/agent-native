import {
  appearancesCss,
  textStylesCss,
  textStyleUtilitiesCss,
  themeCss,
  tokensCss,
} from "./css.js";
import { agentNativeTheme, THEMES } from "./themes/index.js";

/**
 * Every generated stylesheet, keyed by its path under `css/`. Each theme has
 * its own file: an app loads the default theme (through toolkit) and its own,
 * so a theme resets only what the default sets.
 */
export function generatedStylesheets(): Record<string, string> {
  const files: Record<string, string> = {
    "tokens.css": tokensCss(),
    "appearances.css": appearancesCss(),
    "text-styles.css": textStylesCss(),
    "text-style-utilities.css": textStyleUtilitiesCss(),
  };
  for (const theme of THEMES) {
    files[`themes/${theme.name}.css`] = themeCss(
      theme,
      theme.isDefault ? [theme] : [agentNativeTheme, theme],
    );
  }
  return files;
}
