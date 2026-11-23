import {
  appearancesCss,
  textStylesCss,
  textStyleUtilitiesCss,
  themeCss,
  tokensCss,
} from "./css.js";
import { THEMES } from "./themes/index.js";

/**
 * Every generated stylesheet, keyed by its path under `css/`. Each theme has
 * its own file. A theme region can be nested inside any other loaded theme.
 */
export function generatedStylesheets(): Record<string, string> {
  const files: Record<string, string> = {
    "tokens.css": tokensCss(),
    "appearances.css": appearancesCss(),
    "text-styles.css": textStylesCss(),
    "text-style-utilities.css": textStyleUtilitiesCss(),
  };
  for (const theme of THEMES) {
    files[`themes/${theme.name}.css`] = themeCss(theme, THEMES);
  }
  return files;
}
