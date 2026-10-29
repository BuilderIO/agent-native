/**
 * Comment bodies are Markdown. Emails, webhooks and other text-only readers
 * want what a person sees instead: these helpers drop the markers and keep the
 * words. They read the comment with the parser the toolkit's comment renderer
 * uses (CommonMark with GitHub's extensions), so the text matches the screen.
 */

import type { ListItem, Nodes, PhrasingContent, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/**
 * A comment shows Markdown for this many characters and plain text after, so
 * one huge comment can't stall the page that renders it, or the email or
 * webhook that quotes it.
 */
export const COMMENT_MARKDOWN_LIMIT = 20_000;

/**
 * Splits a long comment at a paragraph break near the limit, so the Markdown
 * part doesn't end inside a block when it can help it.
 */
export function splitCommentAtMarkdownLimit(body: string): {
  markdown: string;
  rest: string;
} {
  if (body.length <= COMMENT_MARKDOWN_LIMIT) {
    return { markdown: body, rest: "" };
  }
  const head = body.slice(0, COMMENT_MARKDOWN_LIMIT);
  const paragraphBreak = head.lastIndexOf("\n\n");
  let cut =
    paragraphBreak > COMMENT_MARKDOWN_LIMIT / 2
      ? paragraphBreak
      : COMMENT_MARKDOWN_LIMIT;
  const last = body.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return {
    markdown: body.slice(0, cut),
    rest: body.slice(cut).replace(/^\n+/, ""),
  };
}

/**
 * A comment as plain text. Emphasis, heading, quote and code markers go;
 * links keep their text, so `@[Name](mailto:…)` mentions read `@Name`; raw
 * HTML, images, rules and task checkboxes drop, as the renderer skips them.
 * Code, list markers and line breaks stay, and blocks keep the blank lines
 * the author put between them. Past the Markdown limit the rest stays as
 * written, as the renderer shows it.
 */
export function commentPlainText(markdown: string): string {
  const { markdown: head, rest } = splitCommentAtMarkdownLimit(
    markdown.replace(/\r\n?/g, "\n"),
  );
  const tree = fromMarkdown(head, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  return [blocks(tree.children), rest]
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A comment on one line, cut to `limit` characters with an ellipsis, for an
 * email or notification that quotes it.
 */
export function commentExcerpt(markdown: string, limit = 240): string {
  const collapsed = commentPlainText(markdown).replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  let cut = limit - 1;
  // Don't leave half of a character outside the Basic Multilingual Plane.
  const last = collapsed.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return `${collapsed.slice(0, cut).trimEnd()}…`;
}

/**
 * Blocks one after another, with a blank line between two the author
 * separated by one and a line break otherwise. Blocks the renderer draws
 * nothing for leave no gap.
 */
function blocks(nodes: readonly RootContent[]): string {
  let text = "";
  let previous: RootContent | undefined;
  for (const node of nodes) {
    const block = blockText(node);
    if (block === null) continue;
    if (previous) text += gapBetween(previous, node);
    text += block;
    previous = node;
  }
  return text;
}

function gapBetween(previous: Nodes, next: Nodes): string {
  const end = previous.position?.end.line;
  const start = next.position?.start.line;
  return end !== undefined && start !== undefined && start - end <= 1
    ? "\n"
    : "\n\n";
}

/** A block's text, or null for one the renderer draws nothing for. */
function blockText(node: RootContent): string | null {
  switch (node.type) {
    case "paragraph":
    case "heading": {
      const text = phrasing(node.children);
      return text.trim() ? text : null;
    }
    case "code":
      return node.value;
    case "blockquote":
    case "footnoteDefinition":
      return blocks(node.children) || null;
    case "list": {
      let text = "";
      let number = node.start ?? 1;
      let previous: ListItem | undefined;
      for (const item of node.children) {
        if (previous) text += gapBetween(previous, item);
        const marker = node.ordered ? `${number}. ` : "- ";
        // An item's later lines sit under its first, past the marker.
        const content = blocks(item.children).replace(
          /\n(?=[^\n])/g,
          `\n${" ".repeat(marker.length)}`,
        );
        text += `${marker}${content}`.trimEnd();
        number += 1;
        previous = item;
      }
      return text;
    }
    case "table":
      return node.children
        .map((row) =>
          row.children.map((cell) => phrasing(cell.children)).join(" | "),
        )
        .join("\n");
    case "html":
    case "thematicBreak":
    case "definition":
    case "yaml":
      // The renderer skips raw HTML and draws no text for rules or link
      // definitions.
      return null;
    case "listItem":
    case "tableRow":
    case "tableCell":
      // Read with their list or table.
      return null;
    case "text":
    case "inlineCode":
    case "break":
    case "emphasis":
    case "strong":
    case "delete":
    case "link":
    case "linkReference":
    case "image":
    case "imageReference":
    case "footnoteReference":
      // A parse never puts these outside a block, but read them if it does.
      return phrasingText(node) || null;
  }
}

function phrasing(nodes: readonly PhrasingContent[]): string {
  return nodes.map(phrasingText).join("");
}

function phrasingText(node: PhrasingContent): string {
  switch (node.type) {
    case "text":
      return node.value;
    case "inlineCode":
      // A line break inside code reads as a space, as the renderer draws it.
      return node.value.replace(/\r?\n|\r/g, " ");
    case "break":
      return "\n";
    case "emphasis":
    case "strong":
    case "delete":
    case "link":
    case "linkReference":
      return phrasing(node.children);
    case "html":
    case "image":
    case "imageReference":
    case "footnoteReference":
      // The renderer skips raw HTML and draws no text for images or
      // footnote references.
      return "";
  }
}
