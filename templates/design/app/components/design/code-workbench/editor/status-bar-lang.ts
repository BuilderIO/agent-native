/**
 * Language id -> display name mapping, extracted from StatusBar so it can be
 * unit-tested without importing `monaco-editor` (which requires a `window`
 * global and can't load under vitest's default node environment).
 */
export const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  html: "HTML" /* i18n-ignore */,
  css: "CSS" /* i18n-ignore */,
  json: "JSON" /* i18n-ignore */,
  typescript: "TypeScript" /* i18n-ignore */,
  javascript: "JavaScript" /* i18n-ignore */,
  markdown: "Markdown" /* i18n-ignore */,
  yaml: "YAML" /* i18n-ignore */,
  xml: "XML" /* i18n-ignore */,
  plaintext: "Plain Text" /* i18n-ignore */,
};

export function languageDisplayName(language: string | undefined): string {
  if (!language) return LANGUAGE_DISPLAY_NAMES.plaintext;
  return LANGUAGE_DISPLAY_NAMES[language] ?? language;
}
