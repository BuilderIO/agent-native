import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { cn } from "../../utils.js";
import { ltrCodeBlockProps } from "../code-block-direction.js";

type ShikiHighlighter = {
  codeToHtml: (
    code: string,
    options: {
      lang: string;
      themes: { light: string; dark: string };
      defaultColor?: false | "light" | "dark";
    },
  ) => string | Promise<string>;
  getLoadedLanguages: () => string[];
};

let highlighterLoader: Promise<ShikiHighlighter> | null = null;
function loadHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterLoader) {
    highlighterLoader = (async () => {
      // Use the JavaScript regex engine instead of Oniguruma WASM (~608 KB saved).
      // forgiving:true degrades unsupported patterns gracefully instead of throwing.
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
        ],
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      }) as unknown as Promise<ShikiHighlighter>;
    })().catch((error) => {
      highlighterLoader = null;
      throw error;
    });
  }
  return highlighterLoader;
}

const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  py: "python",
  yml: "yaml",
  md: "markdown",
  bq: "sql",
  bigquery: "sql",
};

/**
 * Human-facing label for a code language hint (the value stored on a code block
 * / code tab). Returns `null` for empty / unknown / plain hints so callers can
 * keep the surface clean (no "Plain text" chrome) when the language is unknown
 * or auto-detected. Web languages lead because plans skew that way.
 */
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

export function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadHighlighter()
      .then((highlighter) => {
        const requested = (language || "text").toLowerCase();
        const resolved = LANG_ALIASES[requested] ?? requested;
        const loaded = highlighter.getLoadedLanguages();
        const lang = loaded.includes(resolved) ? resolved : "text";
        return highlighter.codeToHtml(code, {
          lang,
          themes: {
            light: "github-light-default",
            dark: "github-dark-default",
          },
          defaultColor: false,
        });
      })
      .then((out) => {
        if (!cancelled) setHtml(out as string);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (html) {
    return (
      <div className="plan-shiki" dangerouslySetInnerHTML={{ __html: html }} />
    );
  }
  return (
    <pre>
      <code className={language ? `language-${language}` : undefined}>
        {code}
      </code>
    </pre>
  );
}

/**
 * Default number of code lines shown before a code surface collapses behind a
 * "Show N more lines" toggle. Long code panes (read view, code tabs, API specs)
 * stay scannable instead of dominating the document, matching the rest of the
 * plan's progressively-disclosed surfaces.
 */
export const DEFAULT_CODE_MAX_LINES = 40;

/**
 * Read-only code surface used across the plan blocks (code tabs, API specs) and
 * the markdown read view. Syntax-highlights via {@link HighlightedCode} (Shiki,
 * client-only with a plain `<pre>` SSR fallback), follows the current
 * light/dark `--plan-code` palette, and collapses to `maxLines` with an
 * expand/collapse toggle so long snippets do not run away.
 *
 * `maxLines` of `0` / `null` disables collapsing (show everything). The default
 * is {@link DEFAULT_CODE_MAX_LINES}; the surface only collapses when the code is
 * actually longer than that.
 */
export function CodeSurface({
  code,
  language,
  maxLines = DEFAULT_CODE_MAX_LINES,
  showLanguageLabel = true,
  className,
}: {
  code: string;
  language?: string;
  maxLines?: number | null;
  showLanguageLabel?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const lineCount = useMemo(
    () => (code ? code.replace(/\n$/, "").split("\n").length : 0),
    [code],
  );
  const cap = typeof maxLines === "number" && maxLines > 0 ? maxLines : null;
  const collapsible = cap != null && lineCount > cap;
  const collapsed = collapsible && !expanded;
  const hiddenLines = collapsible ? lineCount - cap : 0;
  const label = prettyLanguageName(language);

  return (
    <div
      {...ltrCodeBlockProps}
      className={cn("plan-code-surface", className ?? "mt-5")}
      data-collapsed={collapsed ? "true" : undefined}
    >
      {showLanguageLabel && label && (
        <div className="plan-code-surface-bar">
          <span className="plan-code-surface-lang">{label}</span>
        </div>
      )}
      <div
        className="plan-code-surface-scroll"
        style={
          collapsed
            ? ({ "--plan-code-max-lines": cap } as CSSProperties)
            : undefined
        }
      >
        <HighlightedCode code={code} language={language} />
        {collapsed && (
          <div className="plan-code-surface-fade" aria-hidden="true" />
        )}
      </div>
      {collapsible && (
        <button
          type="button"
          data-plan-interactive
          className="plan-code-surface-toggle"
          onClick={() => setExpanded((value) => !value)}
        >
          {collapsed
            ? `Show ${hiddenLines} more line${hiddenLines === 1 ? "" : "s"}`
            : "Show less"}
        </button>
      )}
    </div>
  );
}
