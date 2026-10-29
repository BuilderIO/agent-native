import { Children, type ReactNode } from "react";
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

const BLOCK_MARKDOWN_ELEMENTS = [
  ...INLINE_MARKDOWN_ELEMENTS,
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ol",
  "pre",
  "ul",
];

export interface InlineMarkdownProps {
  content: string;
  className?: string | undefined;
  linkClassName?: string | undefined;
  codeClassName?: string | undefined;
  inline?: boolean;
  renderLists?: boolean;
  /**
   * Shows raw HTML as the text it was written as, rather than skip it, so a
   * note like `use <Button> here` keeps its tag. HTML comments stay hidden.
   */
  showRawHtml?: boolean;
  renderLink?:
    | ((href: string, children: ReactNode, className: string) => ReactNode)
    | undefined;
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
  showRawHtml = false,
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
        {Children.map(children, (child) =>
          typeof child === "string"
            ? restoreProtectedSpanSource(child, protectedSpans)
            : child,
        )}
      </code>
    ),
    p: ({ children }) =>
      inline ? <span>{children}</span> : <p className="m-0">{children}</p>,
    ul: ({ children }) => <ul className="list-disc ps-5">{children}</ul>,
    ol: ({ children, start }) => (
      <ol start={start} className="list-decimal ps-5">
        {children}
      </ol>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-s-2 border-border ps-2.5 text-muted-foreground">
        {children}
      </blockquote>
    ),
    // Wraps rather than scrolls sideways, which a keyboard can't reach.
    pre: ({ children }) => (
      <pre className="whitespace-pre-wrap break-words rounded bg-muted p-2 [&>code]:whitespace-pre-wrap [&>code]:bg-transparent [&>code]:p-0">
        {children}
      </pre>
    ),
    h1: Heading,
    h2: Heading,
    h3: Heading,
    h4: Heading,
    h5: Heading,
    h6: Heading,
  };

  const Root = inline ? "span" : "div";
  const blocks = renderLists && !inline;

  return (
    <Root
      className={cn(
        "whitespace-pre-wrap break-words",
        blocks && "flex flex-col gap-2",
        className,
      )}
    >
      <ReactMarkdown
        allowedElements={
          blocks ? BLOCK_MARKDOWN_ELEMENTS : INLINE_MARKDOWN_ELEMENTS
        }
        components={components}
        remarkPlugins={
          showRawHtml ? [remarkGfm, rawHtmlAsText(protectedSpans)] : [remarkGfm]
        }
        rehypePlugins={blocks ? [dropNewlinesBetweenBlocks] : []}
        skipHtml
        unwrapDisallowed
      >
        {renderedContent}
      </ReactMarkdown>
    </Root>
  );
}

// A heading in a comment or note would outrank the page's own headings, so it
// keeps its weight without becoming one.
function Heading({ children }: { children?: ReactNode }) {
  return <p className="m-0 font-semibold">{children}</p>;
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
}

const BLOCK_TAGS = new Set([
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ol",
  "p",
  "pre",
  "ul",
]);

// Markdown separates blocks with newline text, which pre-wrap would show as a
// blank line between every list item; the root's gap spaces blocks instead.
function dropNewlinesBetweenBlocks() {
  const isBlock = (node: HastNode | undefined) =>
    node?.type === "element" && BLOCK_TAGS.has(node.tagName ?? "");
  const visit = (node: HastNode) => {
    if (!node.children) return;
    const children = node.children;
    node.children = children.filter(
      (child, index) =>
        !(
          child.type === "text" &&
          !child.value?.trim() &&
          (isBlock(children[index - 1]) || isBlock(children[index + 1]))
        ),
    );
    node.children.forEach(visit);
  };
  return (tree: HastNode) => visit(tree);
}

interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
}

// Nodes whose children are blocks, where text needs a paragraph to sit in.
const FLOW_PARENTS = new Set([
  "blockquote",
  "footnoteDefinition",
  "listItem",
  "root",
]);

// Turns raw HTML into text, without its comments, before `skipHtml` drops
// it. HTML that was only comments is left for `skipHtml` to drop.
function rawHtmlAsText(spans: readonly InlineMarkdownProtectedSpan[]) {
  return () => {
    const visit = (node: MdastNode) => {
      if (!node.children) return;
      node.children = node.children.map((child) => {
        if (child.type !== "html" || child.value === undefined) {
          visit(child);
          return child;
        }
        const flow = FLOW_PARENTS.has(node.type);
        const html = withoutHtmlComments(child.value);
        if (!html.trim()) return child;
        // A span protected inside the HTML shows its original text.
        const text = {
          type: "text",
          value: restoreProtectedSpanSource(flow ? html.trim() : html, spans),
        };
        return flow ? { type: "paragraph", children: [text] } : text;
      });
    };
    return (tree: MdastNode) => visit(tree);
  };
}

// Strips HTML comments as Core's `commentPlainText` does. One left open runs
// to the end, as the parser reads it.
function withoutHtmlComments(html: string): string {
  return html.replace(/<!--(?:-?>|.*?(?:-->|$))/gs, "");
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

// The link `protectInlineMarkdownSpans` writes for a span: its escaped label,
// then PROTECTED_SPAN_PREFIX and the span's index.
const PROTECTED_SPAN_LINK =
  /\[(?:\\[\\[\]]|[^\\[\]])*\]\(https:\/\/inline-markdown-protected\.invalid\/span\/(\d+)\)/g;

// Markdown leaves link syntax inside code as text, so a span protected there
// would show its placeholder link; code shows the span's original text.
function restoreProtectedSpanSource(
  text: string,
  spans: readonly InlineMarkdownProtectedSpan[],
): string {
  return text.replace(
    PROTECTED_SPAN_LINK,
    (link, index: string) => spans[Number(index)]?.source ?? link,
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
