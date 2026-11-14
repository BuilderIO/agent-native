import { cn } from "@agent-native/toolkit/utils";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  CODE_THEMES,
  loadCodeHighlighter,
  prettyLanguageName,
  resolveCodeLanguage,
} from "../../code-highlighter.js";
import { ltrCodeBlockProps } from "../code-block-direction.js";

export { prettyLanguageName };

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
    loadCodeHighlighter()
      .then((highlighter) =>
        highlighter.codeToHtml(code, {
          lang: resolveCodeLanguage(highlighter, language) ?? "text",
          themes: CODE_THEMES,
          defaultColor: false,
        }),
      )
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

export const DEFAULT_CODE_MAX_LINES = 30;

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
