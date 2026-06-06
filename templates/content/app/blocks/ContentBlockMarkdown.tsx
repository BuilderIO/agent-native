import { useMemo } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Lightweight, dependency-free markdown renderer for registry-block internals.
 *
 * Content's registry blocks (the core dev-doc / OpenAPI library) render their
 * own structured chrome and only defer short prose strings — an endpoint
 * description, a file-tree note, an annotated-code note — to
 * `ctx.renderMarkdown`. Those strings are simple inline markdown (bold, italic,
 * inline code, links) plus the occasional fenced code block. Rather than pull in
 * `react-markdown` + `remark-gfm` (not a content dependency), this renders that
 * narrow subset directly.
 *
 * It is intentionally NOT the document editor: block prose is small, read-mostly,
 * and lives inside the block's own surface. The authoritative document prose
 * still round-trips through `docToNfm` / `nfmToDoc` in `VisualEditor`.
 */

type InlineSegment =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }
  | { kind: "strong"; value: string }
  | { kind: "em"; value: string }
  | { kind: "link"; value: string; href: string };

/**
 * Parse a single line of inline markdown into styled segments. Handles inline
 * code (`` `x` ``), bold (`**x**`), italic (`*x*` / `_x_`), and links
 * (`[label](href)`). Inline code wins first so markup inside backticks stays
 * literal. Anything unmatched is plain text.
 */
function parseInline(line: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  // Order matters: code first (its contents are literal), then links, then
  // bold (`**`/`__`) before italic (`*`/`_`) so `**` is not mis-split.
  const pattern =
    /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*]+\*|_[^_]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        kind: "text",
        value: line.slice(lastIndex, match.index),
      });
    }
    const token = match[0];
    if (match[1]) {
      segments.push({ kind: "code", value: token.slice(1, -1) });
    } else if (match[2]) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch) {
        segments.push({
          kind: "link",
          value: linkMatch[1],
          href: linkMatch[2],
        });
      } else {
        segments.push({ kind: "text", value: token });
      }
    } else if (match[3]) {
      segments.push({ kind: "strong", value: token.slice(2, -2) });
    } else if (match[4]) {
      segments.push({ kind: "em", value: token.slice(1, -1) });
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < line.length) {
    segments.push({ kind: "text", value: line.slice(lastIndex) });
  }
  return segments;
}

function renderInline(line: string, keyPrefix: string): ReactNode[] {
  return parseInline(line).map((segment, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (segment.kind) {
      case "code":
        return (
          <code key={key} className="an-block-md-code">
            {segment.value}
          </code>
        );
      case "strong":
        return <strong key={key}>{segment.value}</strong>;
      case "em":
        return <em key={key}>{segment.value}</em>;
      case "link":
        return (
          <a
            key={key}
            href={segment.href}
            target="_blank"
            rel="noreferrer"
            className="an-block-md-link"
          >
            {segment.value}
          </a>
        );
      default:
        return <span key={key}>{segment.value}</span>;
    }
  });
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "code"; code: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "p"; lines: string[] };

/** Split markdown source into coarse block-level chunks. */
function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code block.
    const fence = /^```(.*)$/.exec(trimmed);
    if (fence) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      blocks.push({ kind: "code", code: code.join("\n") });
      continue;
    }

    // Heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2],
      });
      i += 1;
      continue;
    }

    // Unordered list.
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    // Ordered list.
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    // Paragraph: consume consecutive non-blank, non-structural lines.
    const paragraph: string[] = [];
    while (i < lines.length) {
      const next = lines[i];
      const nextTrimmed = next.trim();
      if (
        !nextTrimmed ||
        /^```/.test(nextTrimmed) ||
        /^#{1,6}\s+/.test(nextTrimmed) ||
        /^[-*+]\s+/.test(nextTrimmed) ||
        /^\d+\.\s+/.test(nextTrimmed)
      ) {
        break;
      }
      paragraph.push(next.trim());
      i += 1;
    }
    blocks.push({ kind: "p", lines: paragraph });
  }

  return blocks;
}

export function ContentBlockMarkdown({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  const blocks = useMemo(() => parseBlocks(markdown ?? ""), [markdown]);

  return (
    <div className={cn("an-block-md", className)}>
      {blocks.map((block, index) => {
        const key = `b-${index}`;
        switch (block.kind) {
          case "heading": {
            const Tag = `h${Math.min(block.level, 6)}` as
              | "h1"
              | "h2"
              | "h3"
              | "h4"
              | "h5"
              | "h6";
            return (
              <Tag key={key} className="an-block-md-heading">
                {renderInline(block.text, key)}
              </Tag>
            );
          }
          case "code":
            return (
              <pre key={key} className="an-block-md-pre">
                <code>{block.code}</code>
              </pre>
            );
          case "ul":
            return (
              <ul key={key} className="an-block-md-ul">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>
                    {renderInline(item, `${key}-${itemIndex}`)}
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="an-block-md-ol">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>
                    {renderInline(item, `${key}-${itemIndex}`)}
                  </li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={key} className="an-block-md-p">
                {block.lines.map((line, lineIndex) => (
                  <span key={`${key}-${lineIndex}`}>
                    {renderInline(line, `${key}-${lineIndex}`)}
                    {lineIndex < block.lines.length - 1 ? <br /> : null}
                  </span>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}

/**
 * Inline markdown field editor for the schema auto-editor's `markdown()`-tagged
 * fields. None of content's registered registry blocks currently reach this
 * (each ships a custom `Edit`), but the registry contract wires it for parity
 * and forward-compat. It is a plain controlled textarea so the raw markdown
 * round-trips losslessly through the block's `data`.
 */
export function ContentBlockMarkdownEditor({
  value,
  onChange,
  editable,
}: {
  value: string;
  onChange: (next: string) => void;
  editable: boolean;
}) {
  if (!editable) {
    return <ContentBlockMarkdown markdown={value} />;
  }
  return (
    <textarea
      className="an-block-md-editor w-full resize-y rounded-md border border-border bg-background p-2 text-sm leading-6 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      rows={4}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
