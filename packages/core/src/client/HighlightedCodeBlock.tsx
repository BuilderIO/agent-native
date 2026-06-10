/**
 * Shared debounced syntax-highlighted code block.
 *
 * Performance characteristics vs the old per-site implementations:
 * - While code is still growing (streaming), Shiki re-highlight is debounced
 *   to ~150 ms (trailing).  Between debounce fires the previous highlighted
 *   HTML is kept — no blank flash.
 * - A content hash gate means identical re-renders never re-invoke Shiki.
 * - A final highlight is triggered immediately when streaming ends (caller
 *   passes streaming=false).
 *
 * Usage:
 *   <HighlightedCodeBlock code={code} lang="typescript" containerClass="agent-markdown-shiki" />
 */
import React, { useEffect, useRef, useState } from "react";

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

export interface HighlightedCodeBlockProps {
  code: string;
  lang: string;
  /** Class applied to the wrapper div when Shiki HTML is rendered. */
  containerClass: string;
  /** Pass true while the parent message is still streaming. When false the
   *  block fires an immediate (non-debounced) highlight pass. */
  streaming?: boolean;
  /** Loader for the site-specific Shiki highlighter instance. Each call site
   *  has its own highlighter loader (different language sets, different CSS
   *  class, etc.) — pass it in so this component stays decoupled. */
  loadHighlighter: () => Promise<{
    codeToHtml: (
      code: string,
      options: {
        lang: string;
        themes: { light: string; dark: string };
        defaultColor?: false | "light" | "dark";
      },
    ) => string | Promise<string>;
    getLoadedLanguages: () => string[];
  }>;
}

const DEBOUNCE_MS = 150;

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

export function HighlightedCodeBlock({
  code,
  lang,
  containerClass,
  streaming = false,
  loadHighlighter,
}: HighlightedCodeBlockProps): React.ReactElement {
  const [html, setHtml] = useState<string | null>(null);
  // Track the content hash for which html was last rendered so identical
  // re-renders never re-invoke Shiki.
  const renderedHashRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const contentHash = hashString(lang + "\0" + code);

    // Skip if we already rendered this exact content
    if (renderedHashRef.current === contentHash) return;

    const doHighlight = () => {
      loadHighlighter()
        .then((highlighter) => {
          const requested = (lang || "text").toLowerCase();
          const resolved = LANG_ALIASES[requested] ?? requested;
          const loaded = highlighter.getLoadedLanguages();
          const finalLang = loaded.includes(resolved) ? resolved : "text";
          return highlighter.codeToHtml(code, {
            lang: finalLang,
            themes: {
              light: "github-light-default",
              dark: "github-dark-default",
            },
            defaultColor: false,
          });
        })
        .then((out) => {
          if (!cancelledRef.current) {
            renderedHashRef.current = contentHash;
            setHtml(out as string);
          }
        })
        .catch(() => {
          if (!cancelledRef.current) {
            renderedHashRef.current = contentHash;
            setHtml(null);
          }
        });
    };

    // Clear any existing pending debounce
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (streaming) {
      // Debounce while the code block is still growing
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        doHighlight();
      }, DEBOUNCE_MS);
    } else {
      // Stream complete (or never was streaming): highlight immediately
      doHighlight();
    }
  }, [code, lang, streaming, loadHighlighter]);

  if (html) {
    return (
      <div
        className={containerClass}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <pre>
      <code className={lang ? `language-${lang}` : undefined}>{code}</code>
    </pre>
  );
}
