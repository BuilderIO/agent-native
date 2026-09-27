import * as monaco from "monaco-editor";

import type { CodeWorkbenchTheme } from "../../code-workbench-theme";
import { buildThemeColors, buildThemeRules } from "./monaco-theme-palette";

export { buildThemeColors, buildThemeRules } from "./monaco-theme-palette";
export type { MonacoThemeRule } from "./monaco-theme-palette";

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
