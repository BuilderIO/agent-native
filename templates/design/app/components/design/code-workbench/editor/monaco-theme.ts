import * as monaco from "monaco-editor";

import type { CodeWorkbenchTheme } from "../../code-workbench-theme";
import { buildThemeColors, buildThemeRules } from "./monaco-theme-palette";

export { buildThemeColors, buildThemeRules } from "./monaco-theme-palette";
export type { MonacoThemeRule } from "./monaco-theme-palette";

/**
 * Define (or redefine) the Monaco theme for the given workbench theme and
 * return its name. Safe to call repeatedly — `monaco.editor.defineTheme`
 * overwrites the existing definition by name. VS Code-quality theme: base
 * vs/vs-dark, inherit true, curated syntax `rules`, and a comprehensive
 * `colors` map, all built from the `--workbench-*` CSS bridge vars via the
 * pure builders in monaco-theme-palette.ts.
 */
export function defineWorkbenchMonacoTheme(theme: CodeWorkbenchTheme): string {
  const dark = theme.colorScheme === "dark";
  const name = dark
    ? "design-code-workbench-dark"
    : "design-code-workbench-light";
  monaco.editor.defineTheme(name, {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: buildThemeRules(theme.colorScheme),
    colors: buildThemeColors(theme.values),
  });
  return name;
}
