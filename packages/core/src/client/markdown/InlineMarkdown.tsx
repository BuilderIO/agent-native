import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";

import { cn } from "../utils.js";

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

export interface InlineMarkdownProps {
  content: string;
  className?: string;
  linkClassName?: string;
  codeClassName?: string;
  inline?: boolean;
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
}

/**
 * Render user-authored Markdown for compact text surfaces.
 *
 * This intentionally has no block-level Markdown elements: headings, lists,
 * quotes, and raw HTML are either flattened to their text or omitted.
 */
export function InlineMarkdown({
  content,
  className,
  linkClassName,
  codeClassName,
  inline = false,
  protectedSpans = [],
  renderProtectedSpan,
}: InlineMarkdownProps) {
  const protectedSpanByHref = new Map(
    protectedSpans
      .map((span, index) => [
        `${PROTECTED_SPAN_PREFIX}${index}`,
        span,
      ] as const)
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
          <span
            className={protectedSpan.className}
            title={protectedSpan.title}
          >
            {children}
          </span>
        );
      }

      const safeHref = href
        ? defaultUrlTransform(normalizeInlineMarkdownHref(href))
        : "";
      if (!safeHref) return <>{children}</>;

      return (
        <a
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "text-primary underline-offset-2 hover:underline",
            linkClassName,
          )}
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
  };

  const Root = inline ? "span" : "div";

  return (
    <Root className={cn("whitespace-pre-wrap break-words", className)}>
      <ReactMarkdown
        allowedElements={INLINE_MARKDOWN_ELEMENTS}
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

const PROTECTED_SPAN_PREFIX = "inline-markdown-protected:";

function protectInlineMarkdownSpans(
  content: string,
  spans: readonly InlineMarkdownProtectedSpan[],
): string {
  return [...spans]
    .map((span, index) => ({ span, index }))
    .filter(({ span }) => span.source.length > 0)
    .sort((a, b) => b.span.source.length - a.span.source.length)
    .reduce(
      (markdown, { span, index }) =>
        markdown.split(span.source).join(
          `[${escapeProtectedSpanLabel(span.label)}](${PROTECTED_SPAN_PREFIX}${index})`,
        ),
      content,
    );
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
