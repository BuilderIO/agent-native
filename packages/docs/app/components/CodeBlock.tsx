import { useEffect, useState, useRef } from "react";
import { codeToHtml } from "shiki";

interface CodeBlockProps {
  code: string;
  lang?: string;
}

export default function CodeBlock({
  code,
  lang = "typescript",
}: CodeBlockProps) {
  const [html, setHtml] = useState("");
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    let cancelled = false;
    codeToHtml(code.trim(), {
      lang,
      themes: {
        light: "github-light-default",
        dark: "github-dark-default",
      },
    }).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  function handleCopy() {
    navigator.clipboard.writeText(code.trim());
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="code-block group relative my-4">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-md border border-[var(--code-border)] bg-[var(--code-bg)] text-xs text-[var(--fg-secondary)] opacity-0 transition hover:text-[var(--fg)] group-hover:opacity-100"
        aria-label="Copy code"
      >
        {copied ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="overflow-x-auto rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)] p-4 text-[13px] leading-[1.7]">
          <code>{code.trim()}</code>
        </pre>
      )}
    </div>
  );
}
