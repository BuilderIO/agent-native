import { useT } from "@agent-native/core/client/i18n";
import type { ReactNode } from "react";

import { notebookMessages } from "@/i18n/messages/notebook";

/**
 * A small, dependency-free markdown renderer for notebook markdown cells.
 *
 * It covers the constructs a notebook cell uses in practice: headings,
 * paragraphs, bullet and numbered lists, blockquotes, fenced code, horizontal
 * rules, inline code, bold, italic and http(s) links. Everything is built as
 * React nodes from the raw text, so nothing is injected as HTML and a link to
 * any other scheme is rendered as plain text.
 */
export type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; language: string | null; text: string }
  | { type: "list"; ordered: boolean; items: string[]; start?: number }
  | { type: "quote"; text: string }
  | { type: "rule" };

const FENCE = /^```(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*(---|\*\*\*|___)\s*$/;

export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    const fence = FENCE.exec(line);
    if (fence !== null) {
      flushParagraph();
      const language = fence[1]?.trim() ?? "";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index] ?? "")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push({
        type: "code",
        language: language === "" ? null : language,
        text: body.join("\n"),
      });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ type: "rule" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      flushParagraph();
      blocks.push({
        type: "heading",
        level: (heading[1] ?? "#").length,
        text: heading[2] ?? "",
      });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote !== null) {
      flushParagraph();
      const parts = [(quote[1] ?? "").trim()];
      while (parts[parts.length - 1] !== "" && index + 1 < lines.length) {
        const next = QUOTE.exec(lines[index + 1] ?? "");
        if (next === null) break;
        parts.push((next[1] ?? "").trim());
        index += 1;
      }
      blocks.push({
        type: "quote",
        text: parts.filter((part) => part !== "").join(" "),
      });
      continue;
    }

    const unordered = UNORDERED.exec(line);
    const ordered = ORDERED.exec(line);
    if (unordered !== null || ordered !== null) {
      flushParagraph();
      const isOrdered = ordered !== null && unordered === null;
      const pattern = isOrdered ? ORDERED : UNORDERED;
      const items: string[] = [];
      const start = isOrdered ? Number(ordered?.[1]) : 1;
      for (;;) {
        const match = pattern.exec(lines[index] ?? "");
        items.push(match?.[isOrdered ? 2 : 1] ?? "");
        let next = index + 1;
        while (next < lines.length && (lines[next] ?? "").trim() === "") {
          next += 1;
        }
        if (next >= lines.length || !pattern.test(lines[next] ?? "")) break;
        index = next;
      }
      blocks.push({
        type: "list",
        ordered: isOrdered,
        items,
        ...(isOrdered && start !== 1 ? { start } : {}),
      });
      continue;
    }

    paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks;
}

const INLINE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\([^)\s]+\))/g;

function safeHref(target: string): string | null {
  return /^https?:\/\//i.test(target) ? target : null;
}

function emphasisIsValid(text: string, index: number, token: string) {
  const marker = token.startsWith("**") || token.startsWith("__") ? 2 : 1;
  const inner = token.slice(marker, -marker);
  if (/^\s|\s$/.test(inner)) return false;
  if (!token.startsWith("_")) return true;
  const before = text[index - 1] ?? "";
  const after = text[index + token.length] ?? "";
  return !/\w/.test(before) && !/\w/.test(after);
}

export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const inline = new RegExp(INLINE.source, "g");
  let ordinal = 0;
  while ((match = inline.exec(text)) !== null) {
    const token = match[0];
    if (
      !token.startsWith("`") &&
      !token.startsWith("[") &&
      !emphasisIsValid(text, match.index, token)
    ) {
      inline.lastIndex = match.index + 1;
      continue;
    }
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const key = `${keyPrefix}-${ordinal}`;
    ordinal += 1;
    if (token.startsWith("`")) {
      nodes.push(
        <code className="nb-md-code" key={key}>
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(
        <strong key={key}>{renderInline(token.slice(2, -2), key)}</strong>,
      );
    } else if (token.startsWith("*") || token.startsWith("_")) {
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const href = link === null ? null : safeHref(link[2] ?? "");
      nodes.push(
        href === null ? (
          <span key={key}>{renderInline(link?.[1] ?? token, key)}</span>
        ) : (
          <a key={key} href={href} target="_blank" rel="noreferrer">
            {renderInline(link?.[1] ?? href, key)}
          </a>
        ),
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function MarkdownCellView({ markdown }: { markdown: string }) {
  const t = useT();
  const blocks = parseMarkdownBlocks(markdown);
  if (blocks.length === 0) {
    return (
      <p className="nb-md-empty">
        {t("notebook.markdownCell.empty", {
          defaultValue: notebookMessages.notebook.markdownCell.empty,
        })}
      </p>
    );
  }
  return (
    <div className="nb-md">
      {blocks.map((block, index) => {
        const key = `b-${index}`;
        switch (block.type) {
          case "heading": {
            const level = Math.min(6, Math.max(1, block.level));
            const content = renderInline(block.text, key);
            return (
              <p
                className={`nb-md-heading nb-md-h${level}`}
                role="heading"
                aria-level={level}
                key={key}
              >
                {content}
              </p>
            );
          }
          case "paragraph":
            return (
              <p className="nb-md-paragraph" key={key}>
                {renderInline(block.text, key)}
              </p>
            );
          case "code":
            return (
              <pre className="nb-md-pre" key={key}>
                <code>{block.text}</code>
              </pre>
            );
          case "list": {
            const items = block.items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>
                {renderInline(item, `${key}-${itemIndex}`)}
              </li>
            ));
            return block.ordered ? (
              <ol className="nb-md-list" key={key} start={block.start}>
                {items}
              </ol>
            ) : (
              <ul className="nb-md-list" key={key}>
                {items}
              </ul>
            );
          }
          case "quote":
            return (
              <blockquote className="nb-md-quote" key={key}>
                {renderInline(block.text, key)}
              </blockquote>
            );
          case "rule":
            return <hr className="nb-md-rule" key={key} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
