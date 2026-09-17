import { normalizeMonacoThemeColor } from "../../code-workbench-theme";

/**
 * Pure theme-rule/color builders, extracted from monaco-theme.ts so unit
 * tests can exercise the palette/color-mapping logic without importing
 * `monaco-editor` (it requires a `window` global and can't load under
 * vitest's default node environment).
 */

export interface MonacoThemeRule {
  token: string;
  foreground?: string;
  fontStyle?: string;
}

/**
 * Curated syntax palette, light/dark HSL pairs converted to hex at build
 * time (Monaco theme rules require hex, no `hsl()`/`var()` support). Kept at
 * modest saturation to match the app's clean Figma-esque visual language.
 */
const SYNTAX_PALETTE: Record<
  string,
  { light: string; dark: string; fontStyle?: string }
> = {
  comment: {
    light: "hsl(0 0% 55%)",
    dark: "hsl(0 0% 50%)",
    fontStyle: "italic",
  },
  keyword: { light: "hsl(263 55% 52%)", dark: "hsl(263 70% 74%)" },
  storage: { light: "hsl(263 55% 52%)", dark: "hsl(263 70% 74%)" },
  string: { light: "hsl(140 45% 36%)", dark: "hsl(140 40% 62%)" },
  number: { light: "hsl(25 75% 45%)", dark: "hsl(28 70% 62%)" },
  constant: { light: "hsl(25 75% 45%)", dark: "hsl(28 70% 62%)" },
  tag: { light: "hsl(213 75% 45%)", dark: "hsl(213 85% 70%)" },
  "attribute.name": { light: "hsl(263 45% 55%)", dark: "hsl(263 55% 75%)" },
  "attribute.value": { light: "hsl(140 45% 36%)", dark: "hsl(140 40% 62%)" },
  "delimiter.html": { light: "hsl(213 75% 45%)", dark: "hsl(213 85% 70%)" },
  function: { light: "hsl(213 75% 45%)", dark: "hsl(213 85% 70%)" },
  type: { light: "hsl(180 45% 35%)", dark: "hsl(180 45% 60%)" },
  class: { light: "hsl(180 45% 35%)", dark: "hsl(180 45% 60%)" },
  delimiter: { light: "hsl(0 0% 40%)", dark: "hsl(0 0% 65%)" },
  operator: { light: "hsl(0 0% 40%)", dark: "hsl(0 0% 65%)" },
};

/** VS Code token identifiers each palette entry applies to. */
const PALETTE_TOKEN_SCOPES: Record<string, string[]> = {
  comment: ["comment", "comment.block", "comment.line"],
  keyword: ["keyword", "keyword.control", "keyword.operator.new"],
  storage: ["storage", "storage.type", "storage.modifier"],
  string: ["string", "string.quoted", "string.template"],
  number: ["number", "constant.numeric"],
  constant: ["constant", "constant.language", "constant.character"],
  tag: ["tag", "entity.name.tag", "metatag"],
  "attribute.name": ["attribute.name", "entity.other.attribute-name"],
  "attribute.value": ["attribute.value", "string.attribute-value"],
  "delimiter.html": ["delimiter.html", "delimiter.xml"],
  function: ["entity.name.function", "support.function", "meta.function-call"],
  type: ["type", "entity.name.type", "support.type"],
  class: ["entity.name.class", "support.class"],
  delimiter: ["delimiter", "delimiter.bracket", "delimiter.parenthesis"],
  operator: ["operator", "keyword.operator"],
};

function hslToHex(hsl: string): string {
  const match = /hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/i.exec(hsl);
  if (!match) return "#000000";
  const h = Number(match[1]);
  const s = Number(match[2]) / 100;
  const l = Number(match[3]) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Build the Monaco theme `rules` array (token -> foreground/fontStyle) for a
 * given color scheme.
 */
export function buildThemeRules(
  colorScheme: "light" | "dark",
): MonacoThemeRule[] {
  const rules: MonacoThemeRule[] = [];
  for (const [paletteKey, scopes] of Object.entries(PALETTE_TOKEN_SCOPES)) {
    const entry = SYNTAX_PALETTE[paletteKey];
    if (!entry) continue;
    const foreground = hslToHex(entry[colorScheme]).replace("#", "");
    for (const token of scopes) {
      rules.push({
        token,
        foreground,
        ...(entry.fontStyle ? { fontStyle: entry.fontStyle } : {}),
      });
    }
  }
  return rules;
}

/**
 * Build the Monaco theme `colors` map from resolved `--workbench-*` CSS
 * values.
 */
export function buildThemeColors(
  values: Record<string, string>,
): Record<string, string> {
  const source: Record<string, string | undefined> = {
    "editor.background": values["--workbench-editor-bg"],
    "editor.foreground": values["--workbench-fg"],
    "editor.lineHighlightBackground": values["--workbench-hover-bg"],
    "editor.selectionBackground": values["--workbench-selection-bg"],
    "editor.inactiveSelectionBackground": values["--workbench-active-bg"],
    "editorCursor.foreground": values["--workbench-accent"],
    "editorLineNumber.foreground": values["--workbench-muted-fg"],
    "editorLineNumber.activeForeground": values["--workbench-fg"],
    "editorIndentGuide.background1": values["--workbench-border"],
    "editorIndentGuide.activeBackground1": values["--workbench-muted-fg"],
    "editorGutter.background": values["--workbench-editor-bg"],

    // Widgets: find, suggest, hover.
    "editorWidget.background": values["--workbench-surface-bg"],
    "editorWidget.border": values["--workbench-border"],
    "editorWidget.foreground": values["--workbench-fg"],
    "editorSuggestWidget.background": values["--workbench-surface-bg"],
    "editorSuggestWidget.border": values["--workbench-border"],
    "editorSuggestWidget.foreground": values["--workbench-fg"],
    "editorSuggestWidget.selectedBackground":
      values["--workbench-list-active-bg"],
    "editorSuggestWidget.highlightForeground": values["--workbench-accent"],
    "editorHoverWidget.background": values["--workbench-surface-bg"],
    "editorHoverWidget.border": values["--workbench-border"],

    // Minimap + scrollbar.
    "minimap.background": values["--workbench-editor-bg"],
    "minimapSlider.background": values["--workbench-hover-bg"],
    "minimapSlider.hoverBackground": values["--workbench-active-bg"],
    "minimapSlider.activeBackground": values["--workbench-active-bg"],
    "scrollbarSlider.background": values["--workbench-hover-bg"],
    "scrollbarSlider.hoverBackground": values["--workbench-active-bg"],
    "scrollbarSlider.activeBackground": values["--workbench-active-bg"],

    // Bracket match + sticky scroll.
    "editorBracketMatch.background": values["--workbench-hover-bg"],
    "editorBracketMatch.border": values["--workbench-accent"],
    "editorStickyScroll.background": values["--workbench-surface-bg"],
    "editorStickyScrollHover.background": values["--workbench-hover-bg"],

    // List (reused for suggest widget rows).
    "list.hoverBackground": values["--workbench-list-hover-bg"],
    "list.activeSelectionBackground": values["--workbench-list-active-bg"],
    "list.inactiveSelectionBackground": values["--workbench-list-selection-bg"],
    "list.focusBackground": values["--workbench-list-active-bg"],
    "list.highlightForeground": values["--workbench-accent"],

    // Inputs.
    "input.background": values["--workbench-input-bg"],
    "input.border": values["--workbench-input-border"],
    "input.foreground":
      values["--workbench-input-fg"] ?? values["--workbench-fg"],
    "inputOption.activeBorder": values["--workbench-accent"],

    // Diff editor (future-proof).
    "diffEditor.insertedTextBackground": values["--workbench-selection-bg"],
    "diffEditor.removedTextBackground": values["--workbench-error"],

    // Markers.
    "editorError.foreground": values["--workbench-error"],
    "editorWarning.foreground": values["--workbench-warning"],

    focusBorder: values["--workbench-accent"],
  };
  const colors: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const normalized = normalizeMonacoThemeColor(value);
    if (normalized) colors[key] = normalized;
  }
  return colors;
}
