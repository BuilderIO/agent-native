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
 * that saves as `@label`, as the plain box saved it.
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
    const reader = new DocReader(head, mentions);
    const tree = fromMarkdown(reader.source, PARSE_OPTIONS);
    reader.collect(tree);
    blocks = reader.flow(tree.children);
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
  return withPlainTail(toMarkdown(root, WRITE_OPTIONS).replace(/\n+$/, ""));
}

/**
 * Past the Markdown limit the renderer shows a comment as written, where the
 * escapes that keep text from formatting would show too, so that part saves
 * without them. Not when it holds a backtick, which may open code whose
 * backslashes are as typed, nor when dropping them would move where the
 * limit cuts.
 */
function withPlainTail(markdown: string): string {
  const { markdown: head, rest } = splitCommentAtMarkdownLimit(markdown);
  if (!rest || rest.includes("`")) return markdown;
  const plain = `${markdown.slice(0, markdown.length - rest.length)}${rest.replace(
    WRITTEN_ESCAPE,
    (_escape, escaped: string | undefined, hex: string | undefined) =>
      escaped ?? String.fromCodePoint(Number.parseInt(hex ?? "", 16)),
  )}`;
  return splitCommentAtMarkdownLimit(plain).markdown === head
    ? plain
    : markdown;
}

/** A backslash escape, or a character reference, as the writer spells them. */
const WRITTEN_ESCAPE = /\\([!-/:-@[-`{-~])|&#x([\dA-F]+);/gi;

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

/** The link a mention stands in for while the comment is parsed. */
const MENTION_LINK = "https://comment-mention.invalid/";
const MENTION_LINK_TEXT =
  /\[(?:\\[\\[\]]|[^\\[\]])*\]\(https:\/\/comment-mention\.invalid\/(\d+)\)/g;

class DocReader {
  /** The text the parser reads: the comment, each mention a link. */
  readonly source: string;
  private readonly found: FoundCommentMention<ReviewMention>[];
  private readonly definitions = new Map<string, string>();
  private readonly footnotes = new Set<string>();

  constructor(markdown: string, mentions: readonly ReviewMention[]) {
    // Found and swapped for links as the renderer does, so Markdown in a
    // label stays part of the chip. One written `@[Name](mailto:…)` stays the
    // link it's written as, which saves it as it was. Too many, or a swap that
    // tangles the text, and the renderer shows them as written, as here.
    const found = findCommentMentions(markdown, mentions).filter(
      (mention) => !mention.inline,
    );
    const source = withMentionLinks(markdown, found);
    const kept =
      found.length <= COMMENT_MENTION_CHIP_LIMIT &&
      !(found.length && isCommentMarkdownTangled(source));
    this.found = kept ? found : [];
    this.source = kept ? source : markdown;
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
    return text.replace(
      MENTION_LINK_TEXT,
      (link, index: string) => this.found[Number(index)]?.source ?? link,
    );
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
      default:
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
          const mention = node.url.startsWith(MENTION_LINK)
            ? this.found[Number(node.url.slice(MENTION_LINK.length))]?.mention
            : undefined;
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
): string {
  let source = "";
  let cursor = 0;
  found.forEach(({ at, source: written, mention }, index) => {
    if (at < cursor) return;
    const label = `@${mention.label}`.replace(/[\\[\]]/g, "\\$&");
    source += `${markdown.slice(cursor, at)}[${label}](${MENTION_LINK}${index})`;
    cursor = at + written.length;
  });
  return source + markdown.slice(cursor);
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

function mentionNode(
  mention: ReviewMention,
  marks: readonly CommentDocMark[],
): CommentDocNode {
  return {
    type: COMMENT_DOC_MENTION,
    attrs: {
      label: mention.label,
      email: mention.email ?? null,
      id: mention.id ?? null,
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
      const first = nodes[0];
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
  for (let last = line[line.length - 1]; last?.type === "text"; ) {
    const text = (last.text ?? "").replace(/[ \t]+$/, "");
    if (text) {
      line[line.length - 1] = { ...last, text };
      break;
    }
    line.pop();
    last = line[line.length - 1];
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
  for (const node of spacesOutsideMarks(bareAddresses(nodes))) {
    const marks = orderedMarks(node);
    let kept = 0;
    for (const [index, frame] of stack.entries()) {
      const mark = marks[index];
      if (!mark || !sameMark(frame.mark, mark)) break;
      kept = index + 1;
    }
    stack.length = kept;
    for (const mark of marks.slice(kept)) {
      const parent = stack[stack.length - 1]?.node ?? root;
      const created = markNode(mark);
      parent.children.push(created);
      stack.push({ mark, node: created });
    }
    const parent = stack[stack.length - 1]?.node ?? root;
    const leaf = leafToMarkdown(node);
    if (leaf) parent.children.push(leaf);
  }
  return root.children;
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
    return label
      ? ({ type: "reviewMention", label } as unknown as PhrasingContent)
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
  /^(?:https?:\/\/|www\.|[\w.+-]+@)[A-Za-z0-9.:/?#@!$&'()+,;=%_-]*[A-Za-z0-9/]$/;
/** What may sit beside a bare address without joining it. */
const BEFORE_BARE_ADDRESS = /^[\s(]?$/;
const AFTER_BARE_ADDRESS = /^[.,;:!?]?(?:\s|$)/;
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
    if (!linksItself || !BARE_ADDRESS.test(text) || !readsAsLink(text, href)) {
      return node;
    }
    const before = nodes[index - 1];
    const after = nodes[index + 1];
    if (
      [before, after].some((neighbour) =>
        neighbour?.marks?.some((mark) => sameMark(mark, link)),
      )
    ) {
      return node;
    }
    // A mention beside it reads as letters.
    const charBefore = before ? (before.text ?? "x").slice(-1) : "";
    const charsAfter = after ? (after.text ?? "x").slice(0, 2) : "";
    if (
      !BEFORE_BARE_ADDRESS.test(charBefore) ||
      !AFTER_BARE_ADDRESS.test(charsAfter)
    ) {
      return node;
    }
    const marks = (node.marks ?? []).filter((mark) => mark !== link);
    return marks.length
      ? { type: BARE_ADDRESS_NODE, text, marks }
      : { type: BARE_ADDRESS_NODE, text };
  });
}

/** Whether `text`, written as it is, reads as a link to `href` showing it. */
function readsAsLink(text: string, href: string): boolean {
  const [block, ...blocks] = fromMarkdown(text, PARSE_OPTIONS).children;
  if (blocks.length || block?.type !== "paragraph") return false;
  const [link, ...others] = block.children;
  if (others.length || link?.type !== "link" || link.url !== href) return false;
  const [label, ...more] = link.children;
  return !more.length && label?.type === "text" && label.value === text;
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
  defaultHandlers
    .text(node, parent, state, info)
    .replace(NEEDLESS_ESCAPE, (escape) =>
      escape === "\\\\" ? escape : escape.slice(1),
    );

const writeMention = Object.assign(
  ((node) => `@${(node as unknown as { label: string }).label}`) as Handle,
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
    listItem: writeListItem,
    reviewMention: writeMention,
    [BARE_ADDRESS_NODE]: writeBareAddress,
  } as ToMarkdownOptions["handlers"],
};
