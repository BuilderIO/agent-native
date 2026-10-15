import type { ReactNode } from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "../../utils.js";

const INLINE_MARKDOWN_ELEMENTS = [
  "a",
  "br",
  "code",
  "del",
  "em",
  "p",
  "s",
  "strong",
] as const;

const BLOCK_MARKDOWN_ELEMENTS = [...INLINE_MARKDOWN_ELEMENTS, "li", "ol", "ul"];

export interface InlineMarkdownProps {
  content: string;
  className?: string;
  linkClassName?: string;
  codeClassName?: string;
  inline?: boolean;
  renderLists?: boolean;
  renderLink?: (
    href: string,
    children: ReactNode,
    className: string,
  ) => ReactNode;
  protectedSpans?: readonly InlineMarkdownProtectedSpan[];
  renderProtectedSpan?: (
    span: InlineMarkdownProtectedSpan,
    children: ReactNode,
  ) => ReactNode;
}

export interface InlineMarkdownProtectedSpan {
  source: string;
  label: string;
  className?: string;
  title?: string;
  /** Protect only the occurrence of `source` starting at this offset. */
  at?: number;
}

export function InlineMarkdown({
  content,
  className,
  linkClassName,
  codeClassName,
  inline = false,
  renderLists = false,
  renderLink,
  protectedSpans = [],
  renderProtectedSpan,
}: InlineMarkdownProps) {
  const protectedSpanByHref = new Map<string, InlineMarkdownProtectedSpan>(
    protectedSpans
      .map((span, index) => [`${PROTECTED_SPAN_PREFIX}${index}`, span] as const)
      .filter(([, span]) => span.source.length > 0),
  );
  const renderedContent = protectInlineMarkdownSpans(content, protectedSpans);
  const components: Components = {
    a: ({ children, href }) => {
      const protectedSpan = href ? protectedSpanByHref.get(href) : undefined;
      if (protectedSpan) {
        return renderProtectedSpan ? (
          renderProtectedSpan(protectedSpan, children)
        ) : (
          <span className={protectedSpan.className} title={protectedSpan.title}>
            {children}
          </span>
        );
      }

      const safeHref = href
        ? defaultUrlTransform(normalizeInlineMarkdownHref(href))
        : "";
      if (!safeHref) return <>{children}</>;
      const anchorClassName = cn(
        "text-primary underline-offset-2 hover:underline",
        linkClassName,
      );
      if (renderLink) return renderLink(safeHref, children, anchorClassName);

      return (
        <a
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer"
          className={anchorClassName}
        >
          {children}
        </a>
      );
    },
    code: ({ children, className: syntaxClassName }) => (
      <code
        className={cn(
          "rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]",
          syntaxClassName,
          codeClassName,
        )}
      >
        {children}
      </code>
    ),
    p: ({ children }) =>
      inline ? <span>{children}</span> : <p className="m-0">{children}</p>,
    ul: ({ children }) => <ul className="list-disc ps-5">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal ps-5">{children}</ol>,
  };

  const Root = inline ? "span" : "div";

  return (
    <Root className={cn("whitespace-pre-wrap break-words", className)}>
      <ReactMarkdown
        allowedElements={
          renderLists && !inline
            ? BLOCK_MARKDOWN_ELEMENTS
            : INLINE_MARKDOWN_ELEMENTS
        }
        components={components}
        remarkPlugins={[remarkGfm]}
        skipHtml
        unwrapDisallowed
      >
        {renderedContent}
      </ReactMarkdown>
    </Root>
  );
}

const PROTECTED_SPAN_PREFIX = "https://inline-markdown-protected.invalid/span/";

// One pass over the original text: replacing span by span would match a
// shorter source again inside the link label a longer one just produced.
function protectInlineMarkdownSpans(
  content: string,
  spans: readonly InlineMarkdownProtectedSpan[],
): string {
  const matches: { start: number; end: number; index: number }[] = [];
  spans.forEach(({ source, at }, index) => {
    if (!source) return;
    if (at !== undefined) {
      if (content.startsWith(source, at))
        matches.push({ start: at, end: at + source.length, index });
      return;
    }
    for (
      let start = content.indexOf(source);
      start !== -1;
      start = content.indexOf(source, start + source.length)
    ) {
      matches.push({ start, end: start + source.length, index });
    }
  });
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  let markdown = "";
  let cursor = 0;
  for (const { start, end, index } of matches) {
    if (start < cursor) continue;
    markdown += `${content.slice(cursor, start)}[${escapeProtectedSpanLabel(spans[index]!.label)}](${PROTECTED_SPAN_PREFIX}${index})`;
    cursor = end;
  }
  return markdown + content.slice(cursor);
}

function escapeProtectedSpanLabel(label: string): string {
  return label.replace(/[\\[\]]/g, "\\$&");
}

function normalizeInlineMarkdownHref(href: string): string {
  if (/^www\./i.test(href)) return `https://${href}`;
  if (/^http:\/\/www\./i.test(href)) {
    return `https://${href.slice("http://".length)}`;
  }
  return href;
}
