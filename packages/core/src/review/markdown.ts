/**
 * The comment box edits a comment as a document of lines, lists, quotes and
 * code blocks, and saves it as Markdown. These convert between the two. They
 * read with the parser the toolkit's comment renderer uses (CommonMark with
 * GitHub's extensions), so the box opens a comment the way it shows, and they
 * write Markdown that shows the way the box did.
 *
 * The document is the box editor's JSON: `paragraph` is one line, and an empty
 * one is the blank line between two paragraphs of Markdown. Marks are `bold`,
 * `italic`, `strike`, `code` and `link`; a mention is a `reviewMention` node
 * that saves as `@label`, as the plain box saved it, or with a `mailto`
 * address as the `@[Name](mailto:…)` it was written as.
 */

import type {
  BlockContent,
  Code,
  Delete,
  Emphasis,
  Link,
  List,
  ListItem,
  Nodes,
  Paragraph,
  PhrasingContent,
  Root,
  Strong,
} from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfmStrikethroughToMarkdown } from "mdast-util-gfm-strikethrough";
import {
  defaultHandlers,
  toMarkdown,
  type Handle,
  type Options as ToMarkdownOptions,
} from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";

import {
  COMMENT_MENTION_CHIP_LIMIT,
  findCommentMentions,
  isCommentMarkdownTangled,
  splitCommentAtMarkdownLimit,
  withoutHtmlComments,
  type FoundCommentMention,
} from "./plain-text.js";
import type { ReviewMention } from "./types.js";

/** A node of the comment box's document, in its editor's JSON shape. */
export type CommentDocNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: CommentDocNode[];
  text?: string;
  marks?: CommentDocMark[];
};

export type CommentDocMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

/** The document node a mention chip is. */
export const COMMENT_DOC_MENTION = "reviewMention";

const PARSE_OPTIONS = {
  extensions: [gfm()],
  mdastExtensions: [gfmFromMarkdown()],
};

/**
 * The box's document for a comment. Where the renderer stops reading Markdown,
 * past the limit or at a paragraph too tangled to read quickly, the rest opens
 * as the lines it shows as. A listed mention's `@label` becomes a chip where
 * the renderer draws one: as a whole word, outside links and code.
 */
export function commentMarkdownToDoc(
  markdown: string,
  mentions: readonly ReviewMention[] = [],
): CommentDocNode {
  const text = markdown.replace(/\r\n?/g, "\n");
  const { markdown: head, rest } = splitCommentAtMarkdownLimit(text);
  let blocks: CommentDocNode[];
  try {
    blocks = readBlocks(head, mentions);
  } catch {
    // coercion-ok: should the parser fail, the renderer shows the comment as
    // written, so the box opens it as written too.
    return doc(plainLines(text));
  }
  if (rest) {
    if (blocks.length) blocks.push({ type: "paragraph" });
    blocks.push(...plainLines(rest));
  }
  return doc(blocks);
}

/**
 * The blocks a comment opens as. Should the text around a mention take its
 * link apart, as `!` before it makes an image or code can, that mention opens
 * as written; should that tangle another, they all do.
 */
function readBlocks(
  markdown: string,
  mentions: readonly ReviewMention[],
): CommentDocNode[] {
  const dropped = new Set<number>();
  for (let attempt = 0; ; attempt += 1) {
    const reader = new DocReader(
      markdown,
      attempt < 2 ? mentions : [],
      dropped,
    );
    const tree = fromMarkdown(reader.source, PARSE_OPTIONS);
    reader.collect(tree);
    const blocks = reader.flow(tree.children);
    const lost = reader.lostMentions();
    if (!lost.length) return blocks;
    for (const at of lost) dropped.add(at);
  }
}

/**
 * The comment the box's document saves as. Lines one after another stay one
 * paragraph, each on its own line; an empty line starts the next paragraph.
 * Text that Markdown would read as formatting is escaped, so it shows as
 * typed.
 */
export function commentDocToMarkdown(content: CommentDocNode): string {
  const root: Root = {
    type: "root",
    children: flowToMarkdown(content.content ?? []),
  };
  return withPlainTail(
    toMarkdown(root, WRITE_OPTIONS).replace(/\n+$/, ""),
    content.content ?? [],
  );
}

/**
 * Past the Markdown limit the renderer shows a comment as written, spaces and
 * empty lines too, so that part saves as the box's lines are typed. Where it
 * isn't just lines of text, it saves without the escapes that would show
 * there, except in code, whose backslashes are as typed. Not when either
 * would move where the limit cuts.
 */
function withPlainTail(
  markdown: string,
  blocks: readonly CommentDocNode[],
): string {
  const { markdown: head, rest } = splitCommentAtMarkdownLimit(markdown);
  if (!rest) return markdown;
  const start = markdown.slice(0, markdown.length - rest.length);
  const shown = withoutEscapesOutsideCode(rest);
  for (const tail of [typedLines(shown, blocks), shown]) {
    if (tail === undefined) continue;
    const plain = `${start}${tail}`;
    if (splitCommentAtMarkdownLimit(plain).markdown === head) return plain;
  }
  return markdown;
}

/**
 * The box's last lines as typed, where they're the lines of text `shown`
 * holds, written without their spaces at either end and empty lines but one.
 */
function typedLines(
  shown: string,
  blocks: readonly CommentDocNode[],
): string | undefined {
  const trim = (line: string) => line.replace(/^[ \t]+|[ \t]+$/g, "");
  const wanted = shown.split("\n").map(trim).filter(Boolean);
  const lines: string[] = [];
  let found = 0;
  for (let index = blocks.length - 1; found < wanted.length; index -= 1) {
    const block = itemAt(blocks, index);
    const content = block?.content ?? [];
    if (
      block?.type !== "paragraph" ||
      content.some((node) => node.type !== "text" || node.marks?.length)
    ) {
      return undefined;
    }
    const line = content.map((node) => node.text ?? "").join("");
    lines.unshift(line);
    if (trim(line)) found += 1;
  }
  const typed = lines.join("\n");
  return lines.map(trim).filter(Boolean).join("\n") === wanted.join("\n")
    ? typed.replace(/\n+$/, "")
    : undefined;
}

/** A backslash escape, or a character reference, as the writer spells them. */
const WRITTEN_ESCAPE = /\\([!-/:-@[-`{-~])|&#x([\dA-F]+);/gi;
/** A fence opening or closing a code block, after any quote or list marks. */
const CODE_FENCE =
  /^(?:[ \t]*(?:>|[-*+]|\d{1,9}[.)])(?=[ \t]|$))*[ \t]*(`{3,}|~{3,})/;

/**
 * Text without the writer's escapes, except in code: a fenced block, or the
 * text between two backtick runs of one length.
 */
function withoutEscapesOutsideCode(text: string): string {
  let fence = "";
  return text
    .split("\n")
    .map((line) => {
      const marker = CODE_FENCE.exec(line)?.[1] ?? "";
      if (fence) {
        if (marker.startsWith(fence)) fence = "";
        return line;
      }
      fence = marker;
      return marker ? line : withoutEscapesOutsideCodeSpans(line);
    })
    .join("\n");
}

function withoutEscapesOutsideCodeSpans(line: string): string {
  const tokens = /\\([!-/:-@[-`{-~])|&#x([\dA-F]+);|`+/gi;
  // Lengths of backtick run with no run of that length after it.
  const unclosed = new Set<number>();
  let result = "";
  let cursor = 0;
  for (let match = tokens.exec(line); match; match = tokens.exec(line)) {
    const token = match[0];
    const escaped = itemAt(match, 1);
    const hex = itemAt(match, 2);
    result += line.slice(cursor, match.index);
    cursor = tokens.lastIndex;
    if (escaped !== undefined || hex !== undefined) {
      result += escaped ?? String.fromCodePoint(Number.parseInt(hex ?? "", 16));
      continue;
    }
    const close = unclosed.has(token.length)
      ? -1
      : closingRun(line, cursor, token.length);
    if (close === -1) unclosed.add(token.length);
    else cursor = close + token.length;
    result += line.slice(match.index, cursor);
    tokens.lastIndex = cursor;
  }
  return result + line.slice(cursor);
}

/** Where the next run of exactly `length` backticks starts, or -1. */
function closingRun(line: string, from: number, length: number): number {
  const runs = /`+/g;
  runs.lastIndex = from;
  for (let run = runs.exec(line); run; run = runs.exec(line)) {
    if (run[0].length === length) return run.index;
  }
  return -1;
}

function doc(blocks: CommentDocNode[]): CommentDocNode {
  return {
    type: "doc",
    content: blocks.length ? blocks : [{ type: "paragraph" }],
  };
}

function paragraph(content: CommentDocNode[]): CommentDocNode {
  return content.length
    ? { type: "paragraph", content }
    : { type: "paragraph" };
}

const BOLD: CommentDocMark = { type: "bold" };
const ITALIC: CommentDocMark = { type: "italic" };
const STRIKE: CommentDocMark = { type: "strike" };
const CODE: CommentDocMark = { type: "code" };

/** Blocks that are lines of text in the box. */
const LINE_BLOCKS = new Set<Nodes["type"]>([
  "paragraph",
  "heading",
  "html",
  "table",
]);

/** The host of the links mentions stand in for while a comment is parsed. */
const MENTION_HOST = "comment-mention.invalid/";

class DocReader {
  /** The text the parser reads: the comment, each mention a link. */
  readonly source: string;
  private readonly found: FoundCommentMention<ReviewMention>[];
  /** Where each mention's link starts in `source`, to its index in `found`. */
  private readonly mentionLinks: ReadonlyMap<number, number>;
  /** The address of mention links, before the mention's index. */
  private readonly mentionLink: string;
  private readonly mentionLinkText: RegExp;
  private readonly definitions = new Map<string, string>();
  private readonly footnotes = new Set<string>();
  /** The mentions read back, as chips or as code shows them, by index. */
  private readonly placed = new Set<number>();

  constructor(
    markdown: string,
    mentions: readonly ReviewMention[],
    dropped: ReadonlySet<number>,
  ) {
    // Found and swapped for links as the renderer does, so Markdown in a
    // label stays part of the chip. One written `@[Name](mailto:…)` keeps its
    // address, to save as it was. Too many, or a swap that tangles the text,
    // and the renderer shows them as written, as here.
    const found = findCommentMentions(markdown, mentions).filter(
      (mention) => !dropped.has(mention.at),
    );
    // A run of x's the comment doesn't hold, so code the comment holds can't
    // pass for a mention's link.
    let run = "x";
    while (markdown.includes(`${MENTION_HOST}${run}`)) run += "x";
    this.mentionLink = `https://${MENTION_HOST}${run}/`;
    this.mentionLinkText = new RegExp(
      String.raw`\[(?:\\[\\[\]<${"`"}]|[^\\[\]])*\]\(${this.mentionLink.replace(/[./]/g, "\\$&")}(\d+)\)`,
      "g",
    );
    const swapped = withMentionLinks(markdown, found, this.mentionLink);
    const kept =
      found.length <= COMMENT_MENTION_CHIP_LIMIT &&
      !(found.length && isCommentMarkdownTangled(swapped.source));
    this.found = kept ? found : [];
    this.source = kept ? swapped.source : markdown;
    this.mentionLinks = kept ? swapped.links : new Map();
  }

  collect(node: Nodes) {
    if (node.type === "definition") {
      if (!this.definitions.has(node.identifier)) {
        this.definitions.set(node.identifier, node.url);
      }
      return;
    }
    if (node.type === "footnoteReference") this.footnotes.add(node.identifier);
    if ("children" in node) {
      for (const child of node.children) this.collect(child);
    }
  }

  /** Text a mention's link stands in for, as written, as code shows it. */
  private written(text: string): string {
    return text.replace(this.mentionLinkText, (link, index: string) => {
      const mention = itemAt(this.found, Number(index));
      if (!mention) return link;
      this.placed.add(Number(index));
      return mention.source;
    });
  }

  /** Where each mention swapped in starts that didn't come back. */
  lostMentions(): number[] {
    const swapped = new Set(this.mentionLinks.values());
    return this.found
      .filter(
        (_mention, index) => swapped.has(index) && !this.placed.has(index),
      )
      .map(({ at }) => at);
  }

  /**
   * The mention a link stands for: one of the links swapped in, found by
   * where it starts, so a link written to the same address stays a link.
   */
  private mentionAt(
    link: Link,
  ): FoundCommentMention<ReviewMention> | undefined {
    const at = link.position?.start.offset;
    const index = at === undefined ? undefined : this.mentionLinks.get(at);
    if (index === undefined || link.url !== `${this.mentionLink}${index}`) {
      return undefined;
    }
    this.placed.add(index);
    return itemAt(this.found, index);
  }

  /**
   * Blocks in order. Two runs of lines in a row get the empty line that
   * separates them, the line the box saves as a paragraph break.
   */
  flow(nodes: readonly Nodes[]): CommentDocNode[] {
    const blocks: CommentDocNode[] = [];
    let afterLines = false;
    for (const node of nodes) {
      const next = this.block(node);
      if (!next.length) continue;
      const lines = LINE_BLOCKS.has(node.type);
      if (afterLines && lines) blocks.push({ type: "paragraph" });
      blocks.push(...next);
      afterLines = lines;
    }
    return blocks;
  }

  private block(node: Nodes): CommentDocNode[] {
    switch (node.type) {
      case "paragraph":
        return this.lines(node.children, []).map(paragraph);
      // A heading shows as a bold line, so it opens as one.
      case "heading":
        return this.lines(node.children, [BOLD]).map(paragraph);
      case "list":
        return [
          {
            type: node.ordered ? "orderedList" : "bulletList",
            ...(node.ordered ? { attrs: { start: node.start ?? 1 } } : {}),
            content: node.children.map((item) => this.listItem(item)),
          },
        ];
      case "listItem":
        return [this.listItem(node)];
      case "blockquote": {
        const content = this.flow(node.children);
        return content.length ? [{ type: "blockquote", content }] : [];
      }
      case "code":
        return [codeBlock({ ...node, value: this.written(node.value) })];
      case "html": {
        const html = withoutHtmlComments(this.written(node.value)).trim();
        return html ? plainLines(html) : [];
      }
      // An unreferenced note is drawn as nothing.
      case "footnoteDefinition":
        return this.footnotes.has(node.identifier)
          ? this.flow(node.children)
          : [];
      // A table shows as its cells' text, a row to a line.
      case "table":
        return node.children.map((row) =>
          paragraph(
            row.children.flatMap((cell, index) => [
              ...(index ? [{ type: "text", text: " | " }] : []),
              ...this.lines(cell.children, []).flat(),
            ]),
          ),
        );
      // Drawn as nothing, so they open as nothing.
      case "thematicBreak":
      case "definition":
      case "image":
      case "imageReference":
        return [];
      // Anything else opens by its children, or as the text it holds.
      case "root":
      case "tableRow":
      case "tableCell":
      case "strong":
      case "emphasis":
      case "delete":
      case "link":
      case "linkReference":
      case "footnoteReference":
      case "inlineCode":
      case "text":
      case "break":
      case "yaml":
        if ("children" in node) return this.flow(node.children);
        if ("value" in node) return plainLines(this.written(node.value));
        return [];
    }
  }

  private listItem(item: ListItem): CommentDocNode {
    const content = this.flow(item.children);
    // An item's first block is its line.
    if (content[0]?.type !== "paragraph")
      content.unshift({ type: "paragraph" });
    return { type: "listItem", content };
  }

  /** Inline content split into lines at its line breaks. */
  private lines(
    nodes: readonly PhrasingContent[],
    marks: readonly CommentDocMark[],
    lines: CommentDocNode[][] = [[]],
  ): CommentDocNode[][] {
    for (const node of nodes) {
      switch (node.type) {
        case "text":
          addText(node.value, marks, lines);
          break;
        case "break":
          lines.push([]);
          break;
        case "strong":
          this.lines(node.children, withMark(marks, BOLD), lines);
          break;
        case "emphasis":
          this.lines(node.children, withMark(marks, ITALIC), lines);
          break;
        case "delete":
          this.lines(node.children, withMark(marks, STRIKE), lines);
          break;
        case "inlineCode":
          addText(this.written(node.value), withMark(marks, CODE), lines);
          break;
        case "link": {
          const mention = this.mentionAt(node);
          if (mention) {
            lines[lines.length - 1]?.push(mentionNode(mention, marks));
          } else {
            this.lines(node.children, withLink(marks, node.url), lines);
          }
          break;
        }
        case "linkReference": {
          const url = this.definitions.get(node.identifier);
          this.lines(
            node.children,
            url === undefined ? marks : withLink(marks, url),
            lines,
          );
          break;
        }
        case "html":
          addText(withoutHtmlComments(this.written(node.value)), marks, lines);
          break;
        case "footnoteReference":
          addText(`[^${node.label ?? node.identifier}]`, marks, lines);
          break;
        case "image":
        case "imageReference":
          break;
        default: {
          // Inline nodes a parser extension adds keep their text.
          const other = node as {
            children?: PhrasingContent[];
            value?: string;
          };
          if (other.children) {
            this.lines(other.children, marks, lines);
          } else if (typeof other.value === "string") {
            addText(other.value, marks, lines);
          }
        }
      }
    }
    return lines;
  }
}

/**
 * The comment with each mention swapped for a link, in one pass: replacing
 * one at a time would find a shorter label again inside a longer one's link.
 */
function withMentionLinks(
  markdown: string,
  found: readonly FoundCommentMention<ReviewMention>[],
  mentionLink: string,
): { source: string; links: Map<number, number> } {
  let source = "";
  let cursor = 0;
  const links = new Map<number, number>();
  found.forEach(({ at, source: written, mention }, index) => {
    if (at < cursor) return;
    // Escaped where code, an autolink or HTML could start and run past it.
    const label = `@${mention.label}`.replace(/[\\[\]<`]/g, "\\$&");
    source += markdown.slice(cursor, at);
    links.set(source.length, index);
    source += `[${label}](${mentionLink}${index})`;
    cursor = at + written.length;
  });
  return { source: source + markdown.slice(cursor), links };
}

/** Text that shows as written, a line to a paragraph. */
function plainLines(text: string): CommentDocNode[] {
  const lines: CommentDocNode[][] = [[]];
  addText(text, [], lines);
  return lines.map(paragraph);
}

function addText(
  value: string,
  marks: readonly CommentDocMark[],
  lines: CommentDocNode[][],
) {
  value.split("\n").forEach((segment, index) => {
    if (index > 0) lines.push([]);
    if (segment) lines[lines.length - 1]?.push(textNode(segment, marks));
  });
}

/**
 * A mention's chip. One written `@[Name](mailto:…)` keeps the address as
 * written in `mailto`, as the comment names its person by it.
 */
function mentionNode(
  { mention, source, inline }: FoundCommentMention<ReviewMention>,
  marks: readonly CommentDocMark[],
): CommentDocNode {
  return {
    type: COMMENT_DOC_MENTION,
    attrs: {
      label: mention.label,
      email: mention.email ?? null,
      id: mention.id ?? null,
      ...(inline
        ? { mailto: source.slice(source.lastIndexOf("(mailto:") + 8, -1) }
        : {}),
    },
    ...(marks.length ? { marks: [...marks] } : {}),
  };
}

function textNode(
  text: string,
  marks: readonly CommentDocMark[],
): CommentDocNode {
  return marks.length
    ? { type: "text", text, marks: [...marks] }
    : { type: "text", text };
}

function withMark(
  marks: readonly CommentDocMark[],
  mark: CommentDocMark,
): CommentDocMark[] {
  return marks.some((current) => current.type === mark.type)
    ? [...marks]
    : [...marks, mark];
}

function withLink(
  marks: readonly CommentDocMark[],
  href: string,
): CommentDocMark[] {
  return [
    ...marks.filter((mark) => mark.type !== "link"),
    { type: "link", attrs: { href } },
  ];
}

function codeBlock(node: Code): CommentDocNode {
  return {
    type: "codeBlock",
    attrs: { language: node.lang ?? null },
    ...(node.value ? { content: [{ type: "text", text: node.value }] } : {}),
  };
}

// Writing.

/** Outermost first; code is drawn inside the others. */
const MARK_ORDER = ["link", "strike", "bold", "italic"];
/** Marks that Markdown can't open or close beside a space. */
const FLANKED_MARKS = new Set(["strike", "bold", "italic"]);

function flowToMarkdown(nodes: readonly CommentDocNode[]): BlockContent[] {
  const blocks: BlockContent[] = [];
  let lines: PhrasingContent[][] = [];
  const endParagraph = () => {
    if (lines.length) blocks.push(joinLines(lines));
    lines = [];
  };
  for (const node of nodes) {
    if (node.type === "paragraph") {
      const line = phrasingToMarkdown(trimLine(node.content ?? []));
      if (line.length) lines.push(line);
      else endParagraph();
      continue;
    }
    endParagraph();
    blocks.push(...blockToMarkdown(node));
  }
  endParagraph();
  return blocks;
}

function blockToMarkdown(node: CommentDocNode): BlockContent[] {
  switch (node.type) {
    case "bulletList":
    case "orderedList": {
      const ordered = node.type === "orderedList";
      const start = Number(node.attrs?.start ?? 1);
      const list: List = {
        type: "list",
        ordered,
        spread: false,
        children: (node.content ?? []).map(
          (item): ListItem => ({
            type: "listItem",
            spread: false,
            children: flowToMarkdown(item.content ?? []),
          }),
        ),
      };
      if (ordered) {
        list.start = Number.isFinite(start)
          ? Math.min(Math.max(Math.trunc(start), 0), MAX_LIST_NUMBER)
          : 1;
      }
      return list.children.length ? [list] : [];
    }
    case "blockquote": {
      const children = flowToMarkdown(node.content ?? []);
      return children.length ? [{ type: "blockquote", children }] : [];
    }
    case "codeBlock": {
      const language = node.attrs?.language;
      return [
        {
          type: "code",
          lang: typeof language === "string" && language ? language : null,
          value: (node.content ?? []).map((child) => child.text ?? "").join(""),
        },
      ];
    }
    default: {
      // Anything else keeps its text: inline content as a line, blocks as
      // blocks.
      const content = node.content ?? [];
      const inline = content.every(
        (child) => child.type === "text" || child.type === COMMENT_DOC_MENTION,
      );
      if (!inline) return flowToMarkdown(content);
      const line = phrasingToMarkdown(trimLine(content));
      return line.length ? [{ type: "paragraph", children: line }] : [];
    }
  }
}

/**
 * Lines of one paragraph, each on its own line. The newline starts the next
 * line's text, so the writer escapes what that line opens with.
 */
function joinLines(lines: PhrasingContent[][]): Paragraph {
  const children: PhrasingContent[] = [];
  lines.forEach((line, index) => {
    const nodes = [...line];
    if (index > 0) {
      const first = itemAt(nodes, 0);
      if (first?.type === "text") {
        nodes[0] = { type: "text", value: `\n${first.value}` };
      } else {
        nodes.unshift({ type: "text", value: "\n" });
      }
    }
    children.push(...nodes);
  });
  return { type: "paragraph", children };
}

/**
 * A line without the spaces at its ends: Markdown drops a paragraph line's
 * leading spaces and reads two trailing ones as a line break.
 */
function trimLine(nodes: readonly CommentDocNode[]): CommentDocNode[] {
  const line = [...nodes];
  while (line[0]?.type === "text") {
    const text = (line[0].text ?? "").replace(/^[ \t]+/, "");
    if (text) {
      line[0] = { ...line[0], text };
      break;
    }
    line.shift();
  }
  for (let last = itemAt(line, line.length - 1); last?.type === "text"; ) {
    const text = (last.text ?? "").replace(/[ \t]+$/, "");
    if (text) {
      line[line.length - 1] = { ...last, text };
      break;
    }
    line.pop();
    last = itemAt(line, line.length - 1);
  }
  return line;
}

type MarkedPhrasing = Link | Delete | Strong | Emphasis;

interface MarkFrame {
  mark: CommentDocMark;
  node: MarkedPhrasing;
}

/** One line's inline nodes as Markdown phrasing, marks nested as they run. */
function phrasingToMarkdown(
  nodes: readonly CommentDocNode[],
): PhrasingContent[] {
  const root: { children: PhrasingContent[] } = { children: [] };
  const stack: MarkFrame[] = [];
  const line = spacesOutsideMarks(bareAddresses(linkTypedAddresses(nodes)));
  line.forEach((node, index) => {
    const marks = orderedMarks(node);
    // Marks still open stay open, from the outside in, so `***a**b*` isn't
    // closed and opened again as `***a****b*`, which reads otherwise.
    let kept = 0;
    for (const frame of stack) {
      if (!marks.some((mark) => sameMark(mark, frame.mark))) break;
      kept += 1;
    }
    stack.length = kept;
    const opening = marks.filter(
      (mark) => !stack.some((frame) => sameMark(frame.mark, mark)),
    );
    // The mark that runs on longest opens outermost, to stay open longest.
    const runs = new Map(
      opening.map((mark) => [mark, markRun(line, index, mark)]),
    );
    opening.sort((a, b) => (runs.get(b) ?? 0) - (runs.get(a) ?? 0));
    for (const mark of opening) {
      const parent = stack.at(-1)?.node ?? root;
      const created = markNode(mark);
      parent.children.push(created);
      stack.push({ mark, node: created });
    }
    const parent = stack.at(-1)?.node ?? root;
    const leaf = leafToMarkdown(node);
    if (leaf) parent.children.push(leaf);
  });
  return root.children;
}

/** How many nodes from `from` on carry `mark`. */
function markRun(
  nodes: readonly CommentDocNode[],
  from: number,
  mark: CommentDocMark,
): number {
  let end = from;
  while (itemAt(nodes, end)?.marks?.some((other) => sameMark(other, mark))) {
    end += 1;
  }
  return end - from;
}

function orderedMarks(node: CommentDocNode): CommentDocMark[] {
  return (node.marks ?? [])
    .filter((mark) => MARK_ORDER.includes(mark.type))
    .sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
}

function sameMark(a: CommentDocMark, b: CommentDocMark): boolean {
  return (
    a.type === b.type && (a.attrs?.href ?? null) === (b.attrs?.href ?? null)
  );
}

function stringAttr(
  attrs: Record<string, unknown> | undefined,
  name: string,
): string {
  const value = attrs?.[name];
  return typeof value === "string" ? value : "";
}

function markNode(mark: CommentDocMark): MarkedPhrasing {
  switch (mark.type) {
    case "link":
      return {
        type: "link",
        url: stringAttr(mark.attrs, "href"),
        children: [],
      };
    case "strike":
      return { type: "delete", children: [] };
    case "bold":
      return { type: "strong", children: [] };
    default:
      return { type: "emphasis", children: [] };
  }
}

function leafToMarkdown(node: CommentDocNode): PhrasingContent | null {
  if (node.type === COMMENT_DOC_MENTION) {
    const label = stringAttr(node.attrs, "label");
    const mailto = stringAttr(node.attrs, "mailto");
    return label
      ? ({ type: "reviewMention", label, mailto } as unknown as PhrasingContent)
      : null;
  }
  if (node.type === BARE_ADDRESS_NODE && node.text) {
    return {
      type: BARE_ADDRESS_NODE,
      value: node.text,
    } as unknown as PhrasingContent;
  }
  if (node.type !== "text" || !node.text) return null;
  return node.marks?.some((mark) => mark.type === "code")
    ? { type: "inlineCode", value: node.text }
    : { type: "text", value: node.text };
}

/** A web or email address the renderer may link when it's typed bare. */
const BARE_ADDRESS =
  /^(?:https?:\/\/|www\.|[\w.+-]+@)[A-Za-z0-9.:/?#@!$&'()+,;=%_-]*[A-Za-z0-9/)]$/;
/** What may sit beside a bare address without joining it. */
const BEFORE_BARE_ADDRESS = /^[\s(]?$/;
/** Punctuation that may follow it, then a space or the end of the line. */
const AFTER_BARE_ADDRESS = /^([.,;:!?)]*)(?:\s|$)/;
/** A bare address, written exactly as it reads. */
const BARE_ADDRESS_NODE = "bareAddress";

/**
 * Drops the link from an address linked to itself, so it saves bare, as it
 * was typed: the renderer links it again. Kept only where the address,
 * written as it is, reads as the same link; escaped, it wouldn't.
 */
function bareAddresses(nodes: readonly CommentDocNode[]): CommentDocNode[] {
  return nodes.map((node, index) => {
    const link = node.marks?.find((mark) => mark.type === "link");
    const text = node.text ?? "";
    if (!link || node.marks?.some((mark) => mark.type === "code")) return node;
    const href = stringAttr(link.attrs, "href");
    const linksItself =
      href === text ||
      href === `mailto:${text}` ||
      (text.startsWith("www.") && href === `http://${text}`);
    if (!linksItself || !BARE_ADDRESS.test(text)) return node;
    const before = itemAt(nodes, index - 1);
    const after = itemAt(nodes, index + 1);
    if (
      [before, after].some((neighbour) =>
        neighbour?.marks?.some((mark) => sameMark(mark, link)),
      )
    ) {
      return node;
    }
    // A mention beside it reads as letters.
    const charBefore = before ? (before.text ?? "x").slice(-1) : "";
    const closing = AFTER_BARE_ADDRESS.exec(after ? (after.text ?? "x") : "");
    if (
      !BEFORE_BARE_ADDRESS.test(charBefore) ||
      !closing ||
      // Marks written between them would join the punctuation to it, and
      // the rest of the line, run right up to the punctuation, would too.
      (closing[1] && after?.marks?.length) ||
      (after && !/\s/.test(closing[0]) && itemAt(nodes, index + 2)) ||
      !readsAsLink(text, href, itemAt(closing, 1) ?? "")
    ) {
      return node;
    }
    const marks = (node.marks ?? []).filter((mark) => mark !== link);
    return marks.length
      ? { type: BARE_ADDRESS_NODE, text, marks }
      : { type: BARE_ADDRESS_NODE, text };
  });
}

/** The last word of a text, where an address would run to its end. */
const LAST_WORD = /[^\s<]*$/;
/** Where a web address the renderer links can start. */
const ADDRESS_START = /https?:\/\/|www\./i;

/**
 * Links a typed address that formatting, a chip or code runs right up to, as
 * the renderer would link it. Written bare, the address would run on through
 * the `*`s or `~`s between them and take what follows into the link.
 */
function linkTypedAddresses(
  nodes: readonly CommentDocNode[],
): CommentDocNode[] {
  return nodes.flatMap((node, index) => {
    const text = node.text ?? "";
    const word = LAST_WORD.exec(text)?.[0] ?? "";
    const at = word.search(ADDRESS_START);
    const next = itemAt(nodes, index + 1);
    if (
      node.type !== "text" ||
      at === -1 ||
      !next ||
      /^\s/.test(next.text ?? "x") ||
      linkedOrCode(node)
    ) {
      return [node];
    }
    const start = text.length - word.length + at;
    const typed = text.slice(start);
    const link = autolinkAt(
      typed,
      start ? text.charAt(start - 1) : writtenLast(itemAt(nodes, index - 1)),
    );
    if (!link) return [node];
    const marks = node.marks ?? [];
    const linked: CommentDocNode = {
      ...node,
      text: typed.slice(0, link.length),
      marks: [...marks, { type: "link", attrs: { href: link.url } }],
    };
    return [
      ...(start ? [{ ...node, text: text.slice(0, start) }] : []),
      linked,
      ...(link.length < typed.length
        ? [{ ...node, text: typed.slice(link.length) }]
        : []),
    ];
  });
}

function linkedOrCode(node: CommentDocNode): boolean {
  return Boolean(
    node.marks?.some((mark) => mark.type === "link" || mark.type === "code"),
  );
}

/**
 * The character written last for `node`, which comes before what follows it.
 * Text beside text with other marks ends in a mark's `*` or `~`.
 */
function writtenLast(node: CommentDocNode | undefined): string {
  if (!node) return "";
  if (node.type === COMMENT_DOC_MENTION) {
    return stringAttr(node.attrs, "mailto")
      ? ")"
      : stringAttr(node.attrs, "label").slice(-1);
  }
  if (node.marks?.some((mark) => mark.type === "code")) return "`";
  if (node.marks?.some((mark) => mark.type === "link")) return ")";
  return "*";
}

/**
 * The link GFM reads from the start of `text`, written after `before`, and
 * how much of `text` it takes.
 */
function autolinkAt(
  text: string,
  before: string,
): { length: number; url: string } | undefined {
  const block = itemAt(
    fromMarkdown(`${before}${text}`, PARSE_OPTIONS).children,
    0,
  );
  const link =
    block?.type === "paragraph"
      ? block.children.find((child): child is Link => child.type === "link")
      : undefined;
  const end = link?.position?.end.offset;
  return link && link.position?.start.offset === before.length && end
    ? { length: end - before.length, url: link.url }
    : undefined;
}

/**
 * Whether `text`, written as it is, reads as a link to `href` showing it, and
 * the punctuation after it stays outside.
 */
function readsAsLink(text: string, href: string, after: string): boolean {
  const blocks = fromMarkdown(`${text}${after}`, PARSE_OPTIONS).children;
  const block = itemAt(blocks, 0);
  if (blocks.length > 1 || block?.type !== "paragraph") return false;
  const phrasing = block.children;
  const link = itemAt(phrasing, 0);
  const rest = itemAt(phrasing, 1);
  if (phrasing.length > (after ? 2 : 1)) return false;
  if (link?.type !== "link" || link.url !== href) return false;
  if (after && (rest?.type !== "text" || rest.value !== after)) return false;
  const label = itemAt(link.children, 0);
  return (
    link.children.length === 1 && label?.type === "text" && label.value === text
  );
}

/** The item at `index`, or nothing past either end. */
function itemAt<T>(list: ArrayLike<T>, index: number): T | undefined {
  return list[index];
}

/**
 * Moves the spaces at the edge of bold, italic or struck text outside it.
 * Markdown can't close `**word **`, so the writer would spell the space as a
 * character reference; outside, it's a plain space.
 */
function spacesOutsideMarks(
  nodes: readonly CommentDocNode[],
): CommentDocNode[] {
  const result: CommentDocNode[] = [];
  nodes.forEach((node, index) => {
    // Code's spaces sit inside its backticks, beside which a mark closes.
    if (
      node.type !== "text" ||
      !node.text ||
      !node.marks?.length ||
      node.marks.some((mark) => mark.type === "code")
    ) {
      result.push(node);
      return;
    }
    const marks = node.marks;
    const opening = marksMissingFrom(marks, nodes[index - 1]);
    const closing = marksMissingFrom(marks, nodes[index + 1]);
    let text = node.text;
    const leading = opening.length ? (/^\s+/.exec(text)?.[0] ?? "") : "";
    text = text.slice(leading.length);
    const trailing =
      closing.length && text ? (/\s+$/.exec(text)?.[0] ?? "") : "";
    text = text.slice(0, text.length - trailing.length);
    if (leading) result.push(withoutMarks(node, leading, opening));
    if (text) result.push({ ...node, text });
    if (trailing) result.push(withoutMarks(node, trailing, closing));
  });
  return result;
}

function marksMissingFrom(
  marks: readonly CommentDocMark[],
  neighbour: CommentDocNode | undefined,
): CommentDocMark[] {
  return marks.filter(
    (mark) =>
      FLANKED_MARKS.has(mark.type) &&
      !neighbour?.marks?.some((other) => sameMark(other, mark)),
  );
}

function withoutMarks(
  node: CommentDocNode,
  text: string,
  dropped: readonly CommentDocMark[],
): CommentDocNode {
  const marks = (node.marks ?? []).filter((mark) => !dropped.includes(mark));
  return marks.length ? { type: "text", text, marks } : { type: "text", text };
}

/**
 * The writer escapes `_` and `*` wherever they could be formatting. Between
 * two letters `_` can't be, nor can `*` between two spaces, so those stay as
 * typed: `snake_case`, `2 * 3`.
 */
const NEEDLESS_ESCAPE =
  /\\\\|(?<=[\p{L}\p{N}])\\_(?=[\p{L}\p{N}])|(?<=[ \t])\\\*(?=[ \t])/gu;

const writeText: Handle = (node, parent, state, info) =>
  typedAddressesAsTyped(
    defaultHandlers
      .text(node, parent, state, info)
      .replace(NEEDLESS_ESCAPE, (escape) =>
        escape === "\\\\" ? escape : escape.slice(1),
      ),
    info.before,
  );

/** A web address typed as text, which the renderer links as it's written. */
const TYPED_ADDRESS = /(?:https?:\/\/|www\.)[^\s<]+/g;
/** What may come before a typed address the renderer links. */
const BEFORE_TYPED_ADDRESS = /^[\s(*_~]?$/;

/**
 * Typed web addresses without the escapes the writer added, which would land
 * in the link: `Python_(language)`, not `Python\_(language)`. Kept escaped
 * where, unescaped, it wouldn't show as typed.
 */
function typedAddressesAsTyped(written: string, before: string): string {
  return written.replace(
    TYPED_ADDRESS,
    (address: string, at: number, whole: string) => {
      const charBefore = at ? whole.charAt(at - 1) : before.slice(-1);
      if (!BEFORE_TYPED_ADDRESS.test(charBefore)) return address;
      const typed = withoutWrittenEscapes(address);
      return typed !== address && shownText(typed) === typed ? typed : address;
    },
  );
}

/** The text Markdown shows, links and all. */
function shownText(markdown: string): string {
  let text = "";
  const visit = (node: Nodes) => {
    if (node.type === "text" || node.type === "inlineCode") text += node.value;
    else if ("children" in node) node.children.forEach(visit);
  };
  visit(fromMarkdown(markdown, PARSE_OPTIONS));
  return text;
}

/** Text as written, with the writer's escapes and references read back. */
function withoutWrittenEscapes(text: string): string {
  return text.replace(
    WRITTEN_ESCAPE,
    (_escape, escaped: string | undefined, hex: string | undefined) =>
      escaped ?? String.fromCodePoint(Number.parseInt(hex ?? "", 16)),
  );
}

type AttentionKind = "letter" | "space" | "punctuation";

/** A character as Markdown sees it beside `*` or `~`. */
function attentionKind(char: string): AttentionKind {
  if (!char || /\s/u.test(char)) return "space";
  return /[\p{P}\p{S}]/u.test(char) ? "punctuation" : "letter";
}

/**
 * Which character to spell as a reference so `~~` opens or closes between
 * them, as the writer does for bold: Markdown reads `x~~**y**~~` as tildes.
 */
function attentionEncoding(
  outside: string,
  inside: string,
): { inside: boolean; outside: boolean } {
  const out = attentionKind(outside);
  const into = attentionKind(inside);
  if (into === "space") {
    return { inside: true, outside: out !== "punctuation" };
  }
  return { inside: false, outside: out === "letter" && into === "punctuation" };
}

function characterReference(char: string): string {
  return `&#x${(char.codePointAt(0) ?? 0).toString(16).toUpperCase()};`;
}

/**
 * Struck text, written as the writer writes bold: where `~~` beside a letter
 * couldn't open or close, that letter is spelled as a reference.
 */
const writeStrike: Handle = (node: Delete, _parent, state, info) => {
  const tracker = state.createTracker(info);
  const exit = state.enter("strikethrough");
  const before = tracker.move("~~");
  let between = tracker.move(
    state.containerPhrasing(node, {
      ...tracker.current(),
      before,
      after: "~",
    }),
  );
  const [head = ""] = between;
  const open = attentionEncoding(info.before.slice(-1), head);
  if (open.inside) {
    between = characterReference(head) + between.slice(head.length);
  }
  const tail = lastCharacter(between);
  const close = attentionEncoding(info.after.charAt(0), tail);
  if (close.inside) {
    between =
      between.slice(0, between.length - tail.length) + characterReference(tail);
  }
  const after = tracker.move("~~");
  exit();
  state.attentionEncodeSurroundingInfo = {
    after: close.outside,
    before: open.outside,
  };
  return before + between + after;
};

function lastCharacter(text: string): string {
  const pair = text.slice(-2);
  return /^[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(pair) ? pair : text.slice(-1);
}

/** The name and address a written `@[Name](mailto:…)` can hold. */
const MAILTO_NAME = /^[^[\]\r\n]+$/;
const MAILTO_ADDRESS = /^[^()\s]+$/;

/** A mention as `@label`, or as the `@[Name](mailto:…)` it was written as. */
const writeMention = Object.assign(
  ((node) => {
    const { label, mailto } = node as unknown as {
      label: string;
      mailto: string;
    };
    return MAILTO_NAME.test(label) && MAILTO_ADDRESS.test(mailto)
      ? `@[${label}](mailto:${mailto})`
      : `@${label}`;
  }) as Handle,
  { peek: () => "@" },
);

const writeBareAddress = Object.assign(
  ((node) => (node as unknown as { value: string }).value) as Handle,
  { peek: (node: unknown) => (node as { value: string }).value.charAt(0) },
);

/** The longest number a list item's marker can have: nine digits. */
const MAX_LIST_NUMBER = 999_999_999;

/**
 * Numbers an ordered list's items on from its start, unless that runs past
 * nine digits, where Markdown stops reading a marker. Then every item takes
 * the start's number, which the renderer counts on from just the same.
 */
const writeListItem: Handle = (node, parent, state, info) => {
  const list = parent?.type === "list" ? parent : undefined;
  if (
    !list?.ordered ||
    (list.start ?? 1) + list.children.length - 1 <= MAX_LIST_NUMBER
  ) {
    return defaultHandlers.listItem(node, parent, state, info);
  }
  const increment = state.options.incrementListMarker;
  state.options.incrementListMarker = false;
  try {
    return defaultHandlers.listItem(node, parent, state, info);
  } finally {
    state.options.incrementListMarker = increment;
  }
};

const WRITE_OPTIONS: ToMarkdownOptions = {
  extensions: [gfmStrikethroughToMarkdown()],
  bullet: "-",
  emphasis: "*",
  strong: "*",
  fences: true,
  listItemIndent: "one",
  handlers: {
    text: writeText,
    delete: writeStrike,
    listItem: writeListItem,
    reviewMention: writeMention,
    [BARE_ADDRESS_NODE]: writeBareAddress,
  } as ToMarkdownOptions["handlers"],
};
