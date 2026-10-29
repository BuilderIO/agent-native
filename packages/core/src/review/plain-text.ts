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

/*
 * The parser's time grows with the square of a paragraph's emphasis markers,
 * and faster still with brackets, quotes and lists nested inside each other:
 * a few thousand characters of them take it seconds, or overflow its stack. A
 * paragraph past any of these, far beyond what people write, shows as written.
 */
/** `*`, `_` and `~` in one paragraph. */
const MAX_EMPHASIS_MARKERS = 1_000;
/** `<!--` in one paragraph; the parser looks ahead from each for its end. */
const MAX_HTML_COMMENTS = 64;
/** Brackets open inside each other. */
const MAX_BRACKET_DEPTH = 16;
/** Quote and list markers opening one line, as in `> > - 1. text`. */
const MAX_LINE_NESTING = 16;

/**
 * Splits a comment where its Markdown stops: before the first paragraph too
 * tangled for the parser to read quickly, or else at a paragraph break near
 * the limit, so the Markdown part doesn't end inside a block when it can help
 * it. Rather than end inside a fenced code block, it stops before the block,
 * which then shows as written with the rest.
 */
export function splitCommentAtMarkdownLimit(body: string): {
  markdown: string;
  rest: string;
} {
  const { tangledAt, fences } = readCommentLines(body);
  let cut = tangledAt;
  if (cut === undefined) {
    if (body.length <= COMMENT_MARKDOWN_LIMIT) {
      return { markdown: body, rest: "" };
    }
    const head = body.slice(0, COMMENT_MARKDOWN_LIMIT);
    const paragraphBreak = head.lastIndexOf("\n\n");
    let limitCut =
      paragraphBreak > COMMENT_MARKDOWN_LIMIT / 2
        ? paragraphBreak
        : COMMENT_MARKDOWN_LIMIT;
    const last = body.charCodeAt(limitCut - 1);
    if (last >= 0xd800 && last <= 0xdbff) limitCut -= 1;
    const split = fences.find(
      (fence) => fence.start < limitCut && limitCut < fence.end,
    );
    cut = split ? split.start : limitCut;
  }
  return {
    markdown: body.slice(0, cut),
    rest: body.slice(cut).replace(/^\n+/, ""),
  };
}

/**
 * A code block fenced at the left margin, from the start of its opening line
 * to the end of its closing line (Infinity if it doesn't close within the
 * limit).
 */
interface Fence {
  start: number;
  end: number;
}

/**
 * Reads a comment's lines up to the limit: where the first paragraph that
 * passes the limits above starts, if one does, and where its fenced code
 * blocks sit. Code isn't Markdown, so it isn't counted. A blank line or a
 * fence always ends a paragraph, so counting between them never counts too
 * few.
 */
function readCommentLines(body: string): {
  tangledAt: number | undefined;
  fences: Fence[];
} {
  const fences: Fence[] = [];
  let fence: (OpeningFence & { start: number }) | undefined;
  // Only fences opened at the left margin are followed. A fence opened in a
  // quote, a list or with a few spaces could be closed by a line that looks
  // like it opens one, and a fence line inside an HTML block is HTML, which
  // can run past blank lines. So after a line that could open either, stop
  // trusting fences and count everything.
  let trustFences = true;
  let paragraph = 0;
  let emphasis = 0;
  let htmlComments = 0;
  let brackets = 0;
  let start = 0;
  while (start < body.length && start < COMMENT_MARKDOWN_LIMIT) {
    // Lines end as the parser ends them: at `\n`, `\r\n` or a lone `\r`.
    let end = start;
    while (end < body.length && !isLineEnding(body.charAt(end))) end += 1;
    const next = end + (body.startsWith("\r\n", end) ? 2 : 1);
    let at = start;
    while (at < end && isSpace(body.charAt(at))) at += 1;
    const opening =
      fence === undefined && trustFences
        ? openingFence(body, start, end)
        : undefined;
    if (fence !== undefined) {
      if (closesFence(body, start, end, fence)) {
        fences.push({ start: fence.start, end });
        fence = undefined;
        paragraph = next;
      }
    } else if (at === end || opening !== undefined) {
      if (opening !== undefined) fence = { ...opening, start };
      paragraph = next;
      emphasis = 0;
      htmlComments = 0;
      brackets = 0;
    } else {
      const text = body.slice(at, end);
      if (
        text.startsWith("<") ||
        text.includes("```") ||
        text.includes("~~~")
      ) {
        trustFences = false;
      }
      if (lineNesting(body, at, end) > MAX_LINE_NESTING) {
        return { tangledAt: paragraph, fences };
      }
      for (let index = at; index < end; index += 1) {
        const char = body.charAt(index);
        if (char === "*" || char === "_" || char === "~") {
          emphasis += 1;
          if (emphasis > MAX_EMPHASIS_MARKERS) {
            return { tangledAt: paragraph, fences };
          }
        } else if (char === "[") {
          brackets += 1;
          if (brackets > MAX_BRACKET_DEPTH) {
            return { tangledAt: paragraph, fences };
          }
        } else if (char === "]") {
          brackets = Math.max(0, brackets - 1);
        } else if (char === "<" && body.startsWith("<!--", index)) {
          htmlComments += 1;
          if (htmlComments > MAX_HTML_COMMENTS) {
            return { tangledAt: paragraph, fences };
          }
        }
      }
    }
    start = next;
  }
  if (fence !== undefined) fences.push({ start: fence.start, end: Infinity });
  return { tangledAt: undefined, fences };
}

interface OpeningFence {
  marker: string;
  length: number;
}

/**
 * The fence a line opens, if it opens one at the left margin. Only there is
 * it sure to be a fence outside any quote or list, which would close it.
 */
function openingFence(
  body: string,
  start: number,
  end: number,
): OpeningFence | undefined {
  const marker = body.charAt(start);
  if (marker !== "`" && marker !== "~") return undefined;
  let at = start;
  while (at < end && body.charAt(at) === marker) at += 1;
  if (at - start < 3) return undefined;
  // A backtick in a backtick fence's info string makes the line text.
  if (marker === "`" && body.slice(at, end).includes("`")) return undefined;
  return { marker, length: at - start };
}

/**
 * Whether a line closes the fence: up to three spaces, at least as many of
 * the fence's markers, and nothing else.
 */
function closesFence(
  body: string,
  start: number,
  end: number,
  fence: OpeningFence,
): boolean {
  let at = start;
  while (at < end && at - start < 3 && body.charAt(at) === " ") at += 1;
  const markers = at;
  while (at < end && body.charAt(at) === fence.marker) at += 1;
  if (at - markers < fence.length) return false;
  while (at < end && isSpace(body.charAt(at))) at += 1;
  return at === end;
}

/** How many quote and list markers open the line from `at` to `end`. */
function lineNesting(body: string, at: number, end: number): number {
  let nesting = 0;
  for (;;) {
    while (at < end && isSpace(body.charAt(at))) at += 1;
    const char = body.charAt(at);
    if (char === ">") {
      nesting += 1;
      at += 1;
      continue;
    }
    let marker = at;
    if (char === "-" || char === "+" || char === "*") {
      marker += 1;
    } else {
      while (marker - at < 9 && isDigit(body.charAt(marker))) marker += 1;
      const delimiter = body.charAt(marker);
      if (marker === at || (delimiter !== "." && delimiter !== ")")) {
        return nesting;
      }
      marker += 1;
    }
    // A list marker is followed by a space or ends the line.
    if (marker < end && !isSpace(body.charAt(marker))) return nesting;
    nesting += 1;
    at = marker;
  }
}

function isSpace(char: string): boolean {
  return char === " " || char === "\t";
}

function isLineEnding(char: string): boolean {
  return char === "\n" || char === "\r";
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

/**
 * A comment as plain text. Emphasis, heading, quote and code markers go;
 * links keep their text, so `@[Name](mailto:…)` mentions read `@Name`; raw
 * HTML, images, rules and task checkboxes drop, as the renderer skips them.
 * Code, list markers and line breaks stay, and blocks keep the blank lines
 * the author put between them. Where the Markdown stops, at the limit or a
 * paragraph too tangled to read quickly, the rest stays as written, as the
 * renderer shows it.
 */
export function commentPlainText(markdown: string): string {
  const text = markdown.replace(/\r\n?/g, "\n");
  const { markdown: head, rest } = splitCommentAtMarkdownLimit(text);
  let read: string;
  try {
    const tree = fromMarkdown(head, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    });
    read = blocks(tree.children);
  } catch {
    // Should the parser fail on something the split didn't catch, the
    // renderer shows the comment as written, and so does this.
    return text.trim();
  }
  return [read, rest]
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
