import type { HighlighterCore } from "shiki/core";

export const CODE_THEMES = {
  light: "github-light-default",
  dark: "github-dark-default",
} as const;

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  py: "python",
  yml: "yaml",
  md: "markdown",
  bq: "sql",
  bigquery: "sql",
  patch: "diff",
};

let highlighterLoader: Promise<HighlighterCore> | null = null;

/** Grammars load one by one: the full bundle would pass the 25 MiB server bundle limit. */
export function loadCodeHighlighter(): Promise<HighlighterCore> {
  if (!highlighterLoader) {
    highlighterLoader = (async () => {
      // The JS regex engine avoids a WASM load; `forgiving` skips bad patterns, not throws.
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] =
        await Promise.all([
          import("shiki/core"),
          import("shiki/engine/javascript"),
        ]);
      return createHighlighterCore({
        themes: [
          import("shiki/themes/github-light-default.mjs"),
          import("shiki/themes/github-dark-default.mjs"),
        ],
        langs: [
          import("shiki/langs/javascript.mjs"),
          import("shiki/langs/typescript.mjs"),
          import("shiki/langs/jsx.mjs"),
          import("shiki/langs/tsx.mjs"),
          import("shiki/langs/json.mjs"),
          import("shiki/langs/css.mjs"),
          import("shiki/langs/html.mjs"),
          import("shiki/langs/markdown.mjs"),
          import("shiki/langs/bash.mjs"),
          import("shiki/langs/shellscript.mjs"),
          import("shiki/langs/python.mjs"),
          import("shiki/langs/yaml.mjs"),
          import("shiki/langs/sql.mjs"),
          import("shiki/langs/diff.mjs"),
        ],
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      });
    })().catch((error: unknown) => {
      // A failed chunk load must not poison every later code block.
      highlighterLoader = null;
      throw error;
    });
  }
  return highlighterLoader;
}

/** Undefined when no grammar is loaded for it; `ansi` is built in. */
export function resolveCodeLanguage(
  highlighter: Pick<HighlighterCore, "getLoadedLanguages">,
  language: string | undefined,
): string | undefined {
  const requested = language
    ?.trim()
    .toLowerCase()
    .replace(/^language-/, "");
  if (!requested) return undefined;
  if (requested === "ansi") return "ansi";
  const resolved = LANGUAGE_ALIASES[requested] ?? requested;
  return highlighter.getLoadedLanguages().includes(resolved)
    ? resolved
    : undefined;
}

const LANGUAGE_LABELS: Record<string, string> = {
  typescript: "TypeScript",
  ts: "TypeScript",
  tsx: "TSX",
  javascript: "JavaScript",
  js: "JavaScript",
  jsx: "JSX",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  bash: "Bash",
  sh: "Bash",
  shell: "Shell",
  zsh: "Bash",
  python: "Python",
  py: "Python",
  sql: "SQL",
  yaml: "YAML",
  yml: "YAML",
  markdown: "Markdown",
  md: "Markdown",
  graphql: "GraphQL",
  go: "Go",
  rust: "Rust",
  ruby: "Ruby",
  java: "Java",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  php: "PHP",
  swift: "Swift",
  kotlin: "Kotlin",
  diff: "Diff",
  dockerfile: "Dockerfile",
  xml: "XML",
};

export function prettyLanguageName(language?: string | null): string | null {
  const raw = language
    ?.trim()
    .toLowerCase()
    .replace(/^language-/, "");
  if (!raw || raw === "text" || raw === "plaintext" || raw === "plain") {
    return null;
  }
  return LANGUAGE_LABELS[raw] ?? raw;
}
