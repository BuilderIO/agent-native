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
  containerClass: string;
  streaming?: boolean;
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
  const [failed, setFailed] = useState(false);
  const renderedHashRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const hasPaintedRef = useRef(false);

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
            setFailed(false);
            setHtml(out as string);
          }
        })
        .catch(() => {
          if (!cancelledRef.current) {
            renderedHashRef.current = contentHash;
            setFailed(true);
            setHtml(null);
          }
        });
    };

    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (streaming) {
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        doHighlight();
      }, DEBOUNCE_MS);
    } else {
      doHighlight();
    }
  }, [code, lang, streaming, loadHighlighter]);

  if (html) {
    hasPaintedRef.current = true;
    return (
      <div
        className={containerClass}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  const showPlain = streaming || failed || hasPaintedRef.current;
  if (showPlain) hasPaintedRef.current = true;
  return (
    <div className={containerClass} aria-busy={!showPlain && !failed}>
      <pre>
        <code
          className={lang ? `language-${lang}` : undefined}
          style={showPlain ? undefined : { visibility: "hidden" }}
        >
          {code}
        </code>
      </pre>
    </div>
  );
}
