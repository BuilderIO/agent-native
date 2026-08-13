import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkGfm from "remark-gfm";

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
}: InlineMarkdownProps) {
  const components: Components = {
    a: ({ children, href }) => {
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
    p: ({ children }) => <p className="m-0">{children}</p>,
  };

  return (
    <div className={cn("whitespace-pre-wrap break-words", className)}>
      <ReactMarkdown
        allowedElements={INLINE_MARKDOWN_ELEMENTS}
        components={components}
        remarkPlugins={[remarkGfm]}
        skipHtml
        unwrapDisallowed
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function normalizeInlineMarkdownHref(href: string): string {
  if (/^www\./i.test(href)) return `https://${href}`;
  if (/^http:\/\/www\./i.test(href)) {
    return `https://${href.slice("http://".length)}`;
  }
  return href;
}
