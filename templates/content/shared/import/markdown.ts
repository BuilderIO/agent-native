import type {
  Blockquote,
  Code,
  FootnoteDefinition,
  Heading,
  List,
  ListItem,
  Nodes,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
} from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parse as parseYaml } from "yaml";

import { nfmToDoc, type PMDoc, type PMMark, type PMNode } from "../nfm";
import { legacyMarkdownToNfm } from "../notion-markdown";
import {
  HIDDEN_HTML_ELEMENTS,
  htmlVisibleText,
  tokenizeHtml,
  type HtmlToken,
} from "./html-fragment";
import { ImportNoteBag } from "./notes";
import { classifyImportReference, type ImportReference } from "./paths";
import type { ImportFrontmatter, ImportedPage, MarkdownDialect } from "./types";

/**
 * Prefix for image sources and link targets that wait on an upload or on the
 * new page id of another imported file. `finalizeMarkdownImport` replaces
 * every one before anything is stored. It is random per draft, so text in the
 * source can neither imitate a placeholder nor be mistaken for one.
 */
function newReferencePrefix(): string {
  const [high, low] = crypto.getRandomValues(new Uint32Array(2));
  return `agent-native-import-reference-${high.toString(36)}${low.toString(36)}:`;
}

export type ImportReferenceSlot =
  | { role: "asset"; reference: ImportReference; written: string }
  | { role: "link"; reference: ImportReference; written: string };

export interface MarkdownImportDraft {
  sourceName: string;
  dialect: MarkdownDialect;
  title: string;
  titleSource: ImportedPage["titleSource"];
  /**
   * Text of the leading heading the title replaced. It left the body, so the
   * text-coverage check counts it as landed; other title text never was body.
   */
  titleHeading: string | null;
  description: string | null;
  icon: string | null;
  frontmatter: ImportFrontmatter;
  /** Image sources and link targets may still hold reference placeholders. */
  doc: PMDoc;
  /** Starts every reference placeholder in `doc`; the slot index follows. */
  referencePrefix: string;
  slots: ImportReferenceSlot[];
  notes: ImportNoteBag;
  /** What a reader of the source sees, for the text-coverage check. */
  coverage:
    | { kind: "markdown"; visible: string[]; accounted: string[] }
    | { kind: "nfm"; source: string };
}

const FRONTMATTER_RE =
  /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const MARKDOWN_EXTENSION_RE = /\.(md|markdown|mdx|txt)$/i;
const SINGLE_EMOJI_RE =
  /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:[️‍\p{Emoji_Modifier}\p{Extended_Pictographic}])*$/u;
const GITHUB_ALERT_RE =
  /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;
const NFM_SIGNALS = [
  /^\t*<empty-block\/>\s*$/m,
  /^\t*<(?:callout|columns|column|synced_block|synced_block_reference|table_of_contents|page|database)\b/m,
  /<mention-[a-z-]+\b/,
  /\{(?:color|toggle)="[^"]*"\}\s*$/m,
  /^\t*<table\s+header-(?:row|column)=/m,
  /<span\s+(?:color|underline)=/,
];

const GITHUB_ALERTS: Record<string, { icon: string; color: string }> = {
  NOTE: { icon: "ℹ️", color: "blue_bg" },
  TIP: { icon: "💡", color: "green_bg" },
  IMPORTANT: { icon: "❗", color: "purple_bg" },
  WARNING: { icon: "⚠️", color: "yellow_bg" },
  CAUTION: { icon: "🛑", color: "red_bg" },
};

const MARK_ORDER = [
  "link",
  "notionSpan",
  "bold",
  "italic",
  "strike",
  "underline",
  "code",
];

const BOLD: PMMark = { type: "bold" };
const ITALIC: PMMark = { type: "italic" };
const STRIKE: PMMark = { type: "strike" };
const UNDERLINE: PMMark = { type: "underline" };
const CODE: PMMark = { type: "code" };
const HIGHLIGHT: PMMark = {
  type: "notionSpan",
  attrs: {
    color: null,
    bgColor: "yellow_bg",
    underline: null,
    href: null,
    attrsJson: "{}",
  },
};

/** HTML elements Content renders the same way. */
const HTML_MARKS: Record<string, PMMark> = {
  b: BOLD,
  strong: BOLD,
  i: ITALIC,
  em: ITALIC,
  cite: ITALIC,
  dfn: ITALIC,
  u: UNDERLINE,
  ins: UNDERLINE,
  s: STRIKE,
  del: STRIKE,
  strike: STRIKE,
  code: CODE,
  mark: HIGHLIGHT,
};

/** HTML elements that arrive with the nearest Content formatting. */
const CONVERTED_HTML_MARKS: Record<string, PMMark> = {
  kbd: CODE,
  samp: CODE,
  tt: CODE,
  var: ITALIC,
};

/** HTML elements that start a new paragraph when a block is flattened. */
const HTML_BLOCK_BREAKS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "center",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "section",
  "summary",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

/** Tags a flattened HTML block reproduces faithfully, so they need no note. */
const FAITHFUL_HTML_TAGS = new Set(["p", "br", "img", "a", "hr", "pre"]);
const MAX_BLOCK_NESTING = 64;
/** Embedded media Content can't show; any fallback text inside is kept. */
const DROPPED_HTML_MEDIA = new Set([
  "video",
  "audio",
  "iframe",
  "embed",
  "object",
  "canvas",
]);

/**
 * Empty cells a file's tables may gain from padding short rows to their
 * widest row. Past this, the cells built would far outnumber those written.
 */
const MAX_TABLE_PADDING_CELLS = 100_000;

type InlinePiece = PMNode | { block: PMNode } | { paragraphBreak: true };

/** An open HTML element whose formatting applies to the text inside it. */
interface HtmlStackEntry {
  name: string;
  mark: PMMark | null;
  /** The `href` an `<a>` was written with. */
  href?: string;
}

export interface ParseMarkdownImportInput {
  /** Import-root-relative path of the file, used for relative references. */
  sourcePath: string;
  text: string;
}

export function parseMarkdownImport(
  input: ParseMarkdownImportInput,
): MarkdownImportDraft {
  const text = input.text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const notes = new ImportNoteBag();
  const frontmatterMatch = FRONTMATTER_RE.exec(text);
  const body = frontmatterMatch ? text.slice(frontmatterMatch[0].length) : text;
  const frontmatter = readFrontmatter(
    frontmatterMatch ? (frontmatterMatch[1] ?? "") : null,
    notes,
  );
  const dialect: MarkdownDialect = looksLikeNfm(body) ? "nfm" : "markdown";
  const referencePrefix = newReferencePrefix();

  let blocks: PMNode[];
  let slots: ImportReferenceSlot[];
  let coverage: MarkdownImportDraft["coverage"];
  if (dialect === "nfm") {
    const converted = convertNfm(
      input.sourcePath,
      body,
      notes,
      referencePrefix,
    );
    blocks = converted.blocks;
    slots = converted.slots;
    coverage = { kind: "nfm", source: body };
  } else {
    const converter = new MarkdownConverter(
      input.sourcePath,
      dropDeepContainerLines(body, notes),
      notes,
      referencePrefix,
    );
    blocks = converter.convert();
    slots = converter.slots;
    coverage = {
      kind: "markdown",
      visible: converter.visibleText(),
      accounted: converter.accounted,
    };
  }

  const title = takeTitle(blocks, frontmatter.title, input.sourcePath, notes);
  return {
    sourceName: input.sourcePath,
    dialect,
    title: title.title,
    titleSource: title.source,
    titleHeading: title.heading,
    description: frontmatter.description,
    icon: frontmatter.icon,
    frontmatter: {
      unmapped: frontmatter.unmapped,
      unreadable: frontmatter.unreadable,
    },
    doc: {
      type: "doc",
      content: blocks.length ? blocks : [{ type: "paragraph" }],
    },
    referencePrefix,
    slots,
    notes,
    coverage,
  };
}

export function titleFromFilename(sourcePath: string): string {
  const name = sourcePath.split(/[\\/]/).pop() ?? "";
  const base = name
    .replace(MARKDOWN_EXTENSION_RE, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return "Untitled";
  return /\p{Lu}/u.test(base) ? base : base[0].toUpperCase() + base.slice(1);
}

/**
 * Drops lines that open more block quotes and lists than `blocks()` converts.
 * The parser's time grows with the square of that depth, and its tree walks
 * overflow the stack, before the converter's own cap is ever reached.
 */
function dropDeepContainerLines(body: string, notes: ImportNoteBag): string {
  let dropped = false;
  const lines = body.split("\n").map((line) => {
    if (containerMarkerCount(line) <= MAX_BLOCK_NESTING) return line;
    notes.add("unsupported-markdown", line);
    dropped = true;
    return "";
  });
  return dropped ? lines.join("\n") : body;
}

/** Counts the block quote and list markers that open a line. */
function containerMarkerCount(line: string): number {
  let count = 0;
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (char === " " || char === "\t") {
      index += 1;
      continue;
    }
    if (char === ">") {
      count += 1;
      index += 1;
      continue;
    }
    let end = index;
    if (char === "-" || char === "*" || char === "+") {
      end += 1;
    } else {
      while (end - index < 9 && /[0-9]/.test(line[end] ?? "")) end += 1;
      if (end === index || (line[end] !== "." && line[end] !== ")")) break;
      end += 1;
    }
    if (end < line.length && line[end] !== " " && line[end] !== "\t") break;
    count += 1;
    index = end;
  }
  return count;
}

function looksLikeNfm(body: string): boolean {
  // One pass over the lines: a fence left open runs to the end of the file,
  // as in CommonMark, instead of being searched for again from every fence.
  const outsideCode: string[] = [];
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    if (fence) {
      if (line.startsWith(fence) && /^[ \t]*$/.test(line.slice(3))) {
        fence = null;
      }
    } else if (line.startsWith("```") || line.startsWith("~~~")) {
      fence = line.slice(0, 3);
    } else {
      outsideCode.push(line);
    }
  }
  const text = outsideCode.join("\n");
  return NFM_SIGNALS.some((signal) => signal.test(text));
}

interface FrontmatterFields {
  title: string | null;
  description: string | null;
  icon: string | null;
  unmapped: Record<string, unknown> | null;
  unreadable: string | null;
}

function readFrontmatter(
  raw: string | null,
  notes: ImportNoteBag,
): FrontmatterFields {
  const fields: FrontmatterFields = {
    title: null,
    description: null,
    icon: null,
    unmapped: null,
    unreadable: null,
  };
  if (raw === null) return fields;

  const record = frontmatterRecord(raw);
  if (record === "unreadable") {
    fields.unreadable = raw;
    notes.add("frontmatter-unreadable", raw.split("\n")[0]);
    return fields;
  }
  if (record === null) return fields;

  // No prototype, so a `__proto__` key is kept like any other.
  const unmapped: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(record)) {
    const name = key.toLowerCase();
    if (
      name === "title" &&
      !fields.title &&
      (typeof value === "string" || typeof value === "number") &&
      String(value).trim()
    ) {
      fields.title = String(value).trim();
    } else if (
      name === "description" &&
      !fields.description &&
      typeof value === "string" &&
      value.trim()
    ) {
      fields.description = value.trim();
    } else if (
      (name === "icon" || name === "emoji") &&
      !fields.icon &&
      typeof value === "string" &&
      SINGLE_EMOJI_RE.test(value.trim())
    ) {
      fields.icon = value.trim();
    } else {
      unmapped[key] = value;
      notes.add("frontmatter-not-shown", key);
    }
  }
  fields.unmapped = Object.keys(unmapped).length ? unmapped : null;
  return fields;
}

/**
 * The frontmatter as a JSON record, null when it is empty, or "unreadable"
 * when it is not a YAML mapping JSON can hold. An alias inside its own anchor
 * parses to a cycle, so the JSON copy fails inside the same try as the parse.
 */
function frontmatterRecord(
  raw: string,
): Record<string, unknown> | null | "unreadable" {
  try {
    const data: unknown = raw.trim()
      ? parseYaml(raw, { maxAliasCount: 50 })
      : {};
    if (data === null || data === undefined) return null;
    if (typeof data !== "object" || Array.isArray(data)) return "unreadable";
    return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  } catch {
    return "unreadable";
  }
}

function takeTitle(
  blocks: PMNode[],
  frontmatterTitle: string | null,
  sourcePath: string,
  notes: ImportNoteBag,
): {
  title: string;
  source: ImportedPage["titleSource"];
  heading: string | null;
} {
  const first = blocks[0];
  const heading =
    first?.type === "heading" && Number(first.attrs?.level) === 1
      ? first
      : null;
  const headingText = heading
    ? collapseWhitespace(inlinePlainText(heading.content ?? []))
    : "";

  if (frontmatterTitle) {
    const duplicate =
      heading &&
      headingText.toLowerCase() ===
        collapseWhitespace(frontmatterTitle).toLowerCase();
    if (duplicate) blocks.shift();
    return {
      title: frontmatterTitle,
      source: "frontmatter",
      heading: duplicate ? headingText : null,
    };
  }
  if (heading && headingText) {
    blocks.shift();
    if (
      (heading.content ?? []).some(
        (node) => node.type !== "text" || (node.marks?.length ?? 0) > 0,
      )
    ) {
      notes.add("title-formatting-removed", headingText);
    }
    return { title: headingText, source: "heading", heading: headingText };
  }
  return {
    title: titleFromFilename(sourcePath),
    source: "filename",
    heading: null,
  };
}

class MarkdownConverter {
  readonly slots: ImportReferenceSlot[] = [];
  /** Source text the converter intentionally did not place on the page. */
  readonly accounted: string[] = [];
  private readonly definitions = new Map<
    string,
    { url: string; title: string | null }
  >();
  private readonly footnotes = new Map<string, FootnoteDefinition>();
  private readonly footnoteNumbers = new Map<string, number>();
  private paddingCellsLeft = MAX_TABLE_PADDING_CELLS;
  private depth = 0;
  private root: Root | null = null;

  constructor(
    private readonly sourcePath: string,
    private readonly source: string,
    private readonly notes: ImportNoteBag,
    private readonly referencePrefix: string,
  ) {}

  convert(): PMNode[] {
    const root = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkMath)
      .parse(this.source) as Root;
    this.root = root;
    walk(root, (node) => {
      if (node.type === "definition") {
        const id = normalizeIdentifier(node.identifier);
        if (!this.definitions.has(id)) {
          this.definitions.set(id, {
            url: node.url,
            title: node.title ?? null,
          });
        }
      } else if (node.type === "footnoteDefinition") {
        const id = normalizeIdentifier(node.identifier);
        if (!this.footnotes.has(id)) this.footnotes.set(id, node);
      }
    });
    this.numberFootnotes(root);

    const blocks = this.blocks(root.children);
    const footnotes = this.footnoteSection();
    if (blocks[blocks.length - 1]?.type === "horizontalRule") footnotes.shift();
    return [...blocks, ...footnotes];
  }

  /** Every string in the source a reader would see once it renders. */
  visibleText(): string[] {
    const out: string[] = [];
    if (!this.root) return out;
    walk(this.root, (node) => {
      if (node.type === "html") {
        out.push(htmlVisibleText(node.value));
      } else if (node.type === "image" || node.type === "imageReference") {
        if (node.alt) out.push(node.alt);
      } else if ("value" in node && typeof node.value === "string") {
        out.push(node.value);
      }
    });
    return out;
  }

  private numberFootnotes(root: Root) {
    const assign = (node: Nodes) => {
      walk(node, (child) => {
        if (child.type !== "footnoteReference") return;
        const id = normalizeIdentifier(child.identifier);
        if (this.footnotes.has(id) && !this.footnoteNumbers.has(id)) {
          this.footnoteNumbers.set(id, this.footnoteNumbers.size + 1);
        }
      });
    };
    for (const child of root.children) {
      if (child.type !== "footnoteDefinition") assign(child);
    }
    // Map iteration also visits ids numbered during the loop, so footnotes
    // referenced only from another footnote's definition are numbered too.
    for (const id of this.footnoteNumbers.keys()) {
      const definition = this.footnotes.get(id);
      if (definition) assign(definition);
    }
    for (const id of this.footnotes.keys()) {
      if (!this.footnoteNumbers.has(id)) {
        this.footnoteNumbers.set(id, this.footnoteNumbers.size + 1);
      }
    }
  }

  private footnoteSection(): PMNode[] {
    if (this.footnotes.size === 0) return [];
    const ordered = [...this.footnoteNumbers.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => this.footnotes.get(id))
      .filter((definition): definition is FootnoteDefinition =>
        Boolean(definition),
      );
    const items = ordered.map((definition) => {
      this.notes.add(
        "footnotes-moved-to-end",
        definition.label ?? definition.identifier,
      );
      return {
        type: "listItem",
        content: withLeadingParagraph(this.blocks(definition.children)),
      };
    });
    return [
      { type: "horizontalRule" },
      { type: "orderedList", content: items },
    ];
  }

  private blocks(source: readonly RootContent[]): PMNode[] {
    // Every later pass over the page recurses per level, so blocks nested
    // past this are reported instead of overflowing the stack.
    if (this.depth >= MAX_BLOCK_NESTING) {
      return source.flatMap((node) => this.unsupportedBlock(node));
    }
    this.depth += 1;
    try {
      return this.blocksAtDepth(source);
    } finally {
      this.depth -= 1;
    }
  }

  private blocksAtDepth(source: readonly RootContent[]): PMNode[] {
    const out: PMNode[] = [];
    const nodes = [...source];
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      if (node.type === "html" && /^\s*<details\b/i.test(node.value)) {
        const toggle = this.details(nodes, index);
        out.push(toggle.node);
        index = toggle.end;
        // Text after `</details>` in the same HTML block is read as a block of
        // its own, which may open another toggle.
        if (toggle.after.trim()) {
          nodes[index] = { type: "html", value: toggle.after };
          index--;
        }
        continue;
      }
      out.push(...this.block(node));
    }
    return out;
  }

  private block(node: RootContent): PMNode[] {
    switch (node.type) {
      case "paragraph":
        return this.paragraphs(this.inline(node.children, []));
      case "heading":
        return this.heading(node);
      case "blockquote":
        return [this.blockquote(node)];
      case "list":
        return this.list(node);
      case "code":
        return [this.code(node)];
      case "math":
        return [equation(node.value)];
      case "thematicBreak":
        return [{ type: "horizontalRule" }];
      case "table":
        return this.table(node);
      case "html":
        return this.paragraphs(this.htmlFragment(node.value));
      case "definition":
      case "footnoteDefinition":
        return [];
      default:
        return this.unsupportedBlock(node as RootContent);
    }
  }

  private unsupportedBlock(node: RootContent): PMNode[] {
    const text = this.sourceSlice(node);
    this.notes.add("unsupported-markdown", text || node.type);
    this.accounted.push(text);
    return [];
  }

  private heading(node: Heading): PMNode[] {
    const pieces = this.inline(node.children, []);
    const inline: PMNode[] = [];
    const after: PMNode[] = [];
    for (const piece of pieces) {
      if ("block" in piece) after.push(piece.block);
      else if (!("paragraphBreak" in piece)) inline.push(piece);
    }
    return [
      {
        type: "heading",
        attrs: { level: Math.min(6, Math.max(1, node.depth)) },
        content: normalizeInline(inline),
      },
      ...after,
    ];
  }

  private blockquote(node: Blockquote): PMNode {
    const [first, ...rest] = node.children;
    const firstText =
      first?.type === "paragraph" && first.children[0]?.type === "text"
        ? first.children[0]
        : null;
    const alert = firstText ? GITHUB_ALERT_RE.exec(firstText.value) : null;
    if (first?.type === "paragraph" && firstText && alert) {
      const kind = alert[1].toUpperCase();
      const style = GITHUB_ALERTS[kind];
      this.notes.add("github-alert-to-callout", kind.toLowerCase());
      this.accounted.push(alert[0]);
      const remainder = firstText.value.slice(alert[0].length);
      const paragraph = {
        ...first,
        children: remainder
          ? [{ ...firstText, value: remainder }, ...first.children.slice(1)]
          : first.children.slice(1),
      };
      const children = [
        ...(paragraph.children.length ? [paragraph] : []),
        ...rest,
      ];
      return {
        type: "notionCallout",
        attrs: { icon: style.icon, color: style.color },
        content: this.blocks(children),
      };
    }
    const content = this.blocks(node.children);
    return {
      type: "blockquote",
      content: content.length ? content : [{ type: "paragraph" }],
    };
  }

  private list(node: List): PMNode[] {
    const groups: Array<{ task: boolean; items: ListItem[] }> = [];
    for (const item of node.children) {
      const task = typeof item.checked === "boolean";
      const last = groups[groups.length - 1];
      if (last && last.task === task) last.items.push(item);
      else groups.push({ task, items: [item] });
    }

    const out: PMNode[] = [];
    let number = node.start ?? 1;
    for (const group of groups) {
      if (group.task) {
        if (node.ordered) {
          this.notes.add(
            "ordered-task-list-unnumbered",
            listItemLabel(group.items[0], this.source),
          );
        }
        out.push({
          type: "taskList",
          content: group.items.map((item) => ({
            type: "taskItem",
            attrs: { checked: item.checked === true },
            content: withLeadingParagraph(this.blocks(item.children)),
          })),
        });
      } else {
        const items = group.items.map((item) => ({
          type: "listItem",
          content: withLeadingParagraph(this.blocks(item.children)),
        }));
        out.push(
          node.ordered
            ? {
                type: "orderedList",
                ...(number !== 1 ? { attrs: { start: number } } : {}),
                content: items,
              }
            : { type: "bulletList", content: items },
        );
      }
      number += group.items.length;
    }
    return out;
  }

  private code(node: Code): PMNode {
    if (node.meta) this.notes.add("code-block-info-dropped", node.meta);
    return {
      type: "codeBlock",
      attrs: { language: node.lang || null },
      content: node.value ? [{ type: "text", text: node.value }] : [],
    };
  }

  private table(node: Table): PMNode[] {
    let columns = 1;
    let cells = 0;
    for (const row of node.children) {
      columns = Math.max(columns, row.children.length);
      cells += row.children.length;
    }
    // Short rows are padded to the widest, so one wide row over many short
    // ones would build far more cells than the source holds.
    const padding = columns * node.children.length - cells;
    if (padding > this.paddingCellsLeft) return this.unsupportedBlock(node);
    this.paddingCellsLeft -= padding;
    const table: PMNode = {
      type: "table",
      attrs: { headerRow: true },
      content: node.children.map((row, rowIndex) => ({
        type: "tableRow",
        content: Array.from({ length: columns }, (_, column) => {
          const cell = row.children[column];
          const align = node.align?.[column] ?? null;
          const blocks = cell ? this.cellBlocks(cell) : [];
          return {
            type: rowIndex === 0 ? "tableHeader" : "tableCell",
            ...(align ? { attrs: { textAlign: align } } : {}),
            content: blocks.length ? blocks : [{ type: "paragraph" }],
          };
        }),
      })),
    };
    return [table];
  }

  /** Stored tables hold no images, so an image in a cell keeps its alt text. */
  private cellBlocks(cell: TableCell): PMNode[] {
    return this.paragraphs(this.inline(cell.children, [])).flatMap((block) => {
      if (block.type !== "image") return [block];
      this.notes.add("unsupported-markdown", this.sourceSlice(cell));
      const alt = String(block.attrs?.alt ?? "");
      return alt ? [{ type: "paragraph", content: [textNode(alt, [])] }] : [];
    });
  }

  /**
   * `<details>` is block HTML in Markdown, so CommonMark splits it into an
   * opening HTML node, ordinary Markdown blocks, and a closing HTML node.
   */
  private details(
    nodes: readonly RootContent[],
    start: number,
  ): { node: PMNode; end: number; after: string } {
    const opening = (nodes[start] as { value: string }).value;
    const openingTag = /^\s*<details\b[^>]*>/i.exec(opening)?.[0] ?? "";
    const open = /\bopen\b/i.test(openingTag);
    // Found by index, not one lazy regex, so many unclosed `<summary>` tags
    // cost one scan instead of one per tag.
    let head = opening.slice(openingTag.length);
    let summary = "";
    const summaryOpen = /<summary\b[^<>]*>/i.exec(head);
    if (summaryOpen) {
      const textStart = summaryOpen.index + summaryOpen[0].length;
      const summaryClose = head.toLowerCase().indexOf("</summary>", textStart);
      if (summaryClose !== -1) {
        summary = collapseWhitespace(
          htmlVisibleText(head.slice(textStart, summaryClose)),
        );
        head =
          head.slice(0, summaryOpen.index) +
          head.slice(summaryClose + "</summary>".length);
      }
    }

    const children: PMNode[] = [];
    let end = nodes.length - 1;
    let after = "";
    const closedInHead = splitAtDetailsClose(head, 1);
    if ("before" in closedInHead) {
      children.push(...this.paragraphs(this.htmlFragment(closedInHead.before)));
      end = start;
      after = closedInHead.after;
    } else {
      if (head.trim()) {
        children.push(...this.paragraphs(this.htmlFragment(head)));
      }
      let depth = closedInHead.depth;
      const inner: RootContent[] = [];
      for (let index = start + 1; index < nodes.length; index++) {
        const node = nodes[index];
        if (node.type === "html") {
          const closed = splitAtDetailsClose(node.value, depth);
          if ("before" in closed) {
            children.push(...this.blocks(inner));
            if (closed.before.trim()) {
              children.push(
                ...this.paragraphs(this.htmlFragment(closed.before)),
              );
            }
            end = index;
            after = closed.after;
            inner.length = 0;
            depth = 0;
            break;
          }
          depth = closed.depth;
        }
        inner.push(node);
      }
      if (depth > 0) children.push(...this.blocks(inner));
    }

    return {
      node: {
        type: "notionToggle",
        attrs: { summary, ...(open ? { open: true } : {}) },
        content: children,
      },
      end,
      after,
    };
  }

  private inline(
    nodes: readonly PhrasingContent[],
    marks: readonly PMMark[],
  ): InlinePiece[] {
    const out: InlinePiece[] = [];
    const htmlStack: HtmlStackEntry[] = [];
    const active = () => [
      ...marks,
      ...htmlStack.flatMap((entry) => (entry.mark ? [entry.mark] : [])),
    ];

    for (const node of nodes) {
      switch (node.type) {
        case "text":
          out.push(textNode(joinSoftBreaks(node.value), active()));
          break;
        case "emphasis":
          out.push(...this.inline(node.children, [...active(), ITALIC]));
          break;
        case "strong":
          out.push(...this.inline(node.children, [...active(), BOLD]));
          break;
        case "delete":
          out.push(...this.inline(node.children, [...active(), STRIKE]));
          break;
        case "inlineCode":
          out.push(textNode(node.value, [...active(), CODE]));
          break;
        case "break":
          out.push({ type: "hardBreak" });
          break;
        case "link":
          out.push(
            ...this.link(node.url, node.title ?? null, active(), (linkMarks) =>
              this.inline(node.children, linkMarks),
            ),
          );
          break;
        case "linkReference": {
          const definition = this.definitions.get(
            normalizeIdentifier(node.identifier),
          );
          if (definition) {
            out.push(
              ...this.link(
                definition.url,
                definition.title,
                active(),
                (linkMarks) => this.inline(node.children, linkMarks),
              ),
            );
          } else {
            out.push(textNode(this.sourceSlice(node), active()));
          }
          break;
        }
        case "image":
          out.push({
            block: this.image(node.url, node.alt ?? "", node.title ?? null),
          });
          break;
        case "imageReference": {
          const definition = this.definitions.get(
            normalizeIdentifier(node.identifier),
          );
          if (definition) {
            out.push({
              block: this.image(
                definition.url,
                node.alt ?? "",
                definition.title,
              ),
            });
          } else {
            out.push(textNode(this.sourceSlice(node), active()));
          }
          break;
        }
        case "inlineMath": {
          const raw = this.sourceSlice(node);
          out.push(
            isDollarAmountPair(
              raw,
              node.value,
              this.source,
              node.position?.end?.offset,
            )
              ? textNode(raw, active())
              : {
                  type: "notionInlineAtom",
                  attrs: {
                    tagName: "math",
                    attrsJson: "{}",
                    label: node.value,
                  },
                },
          );
          break;
        }
        case "footnoteReference": {
          const number = this.footnoteNumbers.get(
            normalizeIdentifier(node.identifier),
          );
          out.push(
            textNode(
              number ? `[${number}]` : this.sourceSlice(node),
              active().filter((mark) => mark.type !== "link"),
            ),
          );
          break;
        }
        case "html":
          out.push(...this.inlineHtml(node.value, htmlStack, active));
          break;
        default: {
          const unknown = node as Nodes;
          const text = this.sourceSlice(unknown);
          this.notes.add("unsupported-markdown", text || unknown.type);
          this.accounted.push(text);
        }
      }
    }
    return out;
  }

  /** Inline HTML arrives one tag per node, so marks span sibling nodes. */
  private inlineHtml(
    html: string,
    stack: HtmlStackEntry[],
    active: () => PMMark[],
  ): InlinePiece[] {
    const out: InlinePiece[] = [];
    for (const token of tokenizeHtml(html)) {
      if (token.type === "text") {
        if (token.text) out.push(textNode(token.text, active()));
      } else if (token.type === "hidden") {
        this.dropHidden(token.raw);
      } else if (token.type === "close") {
        const index = findLastIndex(
          stack,
          (entry) => entry.name === token.name,
        );
        if (index !== -1) stack.splice(index);
      } else if (token.name === "br") {
        out.push({ type: "hardBreak" });
      } else if (token.name === "img") {
        out.push(this.htmlImagePiece(token, stack));
      } else if (DROPPED_HTML_MEDIA.has(token.name)) {
        this.notes.add("unsupported-markdown", `<${token.name}>`);
      } else if (!token.selfClosing) {
        this.openHtmlElement(stack, token, "inline");
      }
    }
    return out;
  }

  /**
   * Past the nesting cap an element is reported instead of tracked: every text
   * run rebuilds its marks from the stack, so thousands of unclosed tags would
   * cost the square of their number.
   */
  private openHtmlElement(
    stack: HtmlStackEntry[],
    token: Extract<HtmlToken, { type: "open" }>,
    context: "inline" | "block",
  ) {
    if (stack.length >= MAX_BLOCK_NESTING) {
      this.notes.add("unsupported-markdown", `<${token.name}>`);
      return;
    }
    stack.push({
      name: token.name,
      mark: this.htmlTagMark(token, context),
      href: token.attrs.href,
    });
  }

  private htmlTagMark(
    token: Extract<HtmlToken, { type: "open" }>,
    context: "inline" | "block",
  ): PMMark | null {
    if (token.name === "a") {
      const href = token.attrs.href;
      if (!href) return null;
      return this.linkMark(href, token.attrs.title ?? null);
    }
    const mark = HTML_MARKS[token.name];
    if (mark) return mark;
    const converted = CONVERTED_HTML_MARKS[token.name];
    if (converted) {
      this.notes.add("html-formatting-converted", `<${token.name}>`);
      return converted;
    }
    if (context === "inline") {
      this.notes.add("html-tag-removed", `<${token.name}>`);
    }
    return null;
  }

  /**
   * Flattens an HTML fragment into paragraphs, images, and code, keeping its
   * visible text and the formatting Content can show.
   */
  private htmlFragment(html: string): InlinePiece[] {
    const out: InlinePiece[] = [];
    const stack: HtmlStackEntry[] = [];
    const flattened = new Set<string>();
    // A hidden element ends at its own closing tag; tags inside it don't count.
    let hidden: string | null = null;
    let preText: string[] | null = null;
    let preLanguage: string | null = null;
    const active = () =>
      stack.flatMap((entry) => (entry.mark ? [entry.mark] : []));

    for (const token of tokenizeHtml(html)) {
      if (hidden) {
        if (token.type === "close" && token.name === hidden) hidden = null;
        continue;
      }
      if (preText) {
        if (token.type === "close" && token.name === "pre") {
          out.push({ block: codeBlock(preText.join(""), preLanguage) });
          preText = null;
          preLanguage = null;
        } else if (token.type === "text") {
          preText.push(token.text);
        } else if (token.type === "open" && token.name === "code") {
          preLanguage ??=
            /\blanguage-([\w+-]+)/.exec(token.attrs.class ?? "")?.[1] ?? null;
        }
        continue;
      }

      if (token.type === "text") {
        const text = token.text.replace(/\s+/g, " ");
        if (text.trim() || out.length) out.push(textNode(text, active()));
        continue;
      }
      if (token.type === "hidden") {
        this.dropHidden(token.raw);
        continue;
      }
      if (token.type === "open" && HIDDEN_HTML_ELEMENTS.has(token.name)) {
        if (!token.selfClosing) {
          hidden = token.name;
          this.notes.add("hidden-html-dropped", `<${token.name}>`);
        }
        continue;
      }
      if (DROPPED_HTML_MEDIA.has(token.name)) {
        if (token.type === "open") {
          this.notes.add("unsupported-markdown", `<${token.name}>`);
        }
        continue;
      }
      if (
        !FAITHFUL_HTML_TAGS.has(token.name) &&
        !HTML_MARKS[token.name] &&
        !CONVERTED_HTML_MARKS[token.name]
      ) {
        flattened.add(token.name);
      }
      if (token.type === "close") {
        const index = findLastIndex(
          stack,
          (entry) => entry.name === token.name,
        );
        if (index !== -1) stack.splice(index);
        if (HTML_BLOCK_BREAKS.has(token.name))
          out.push({ paragraphBreak: true });
        continue;
      }
      if (token.name === "br") {
        out.push({ type: "hardBreak" });
      } else if (token.name === "img") {
        out.push(this.htmlImagePiece(token, stack));
      } else if (token.name === "hr") {
        out.push({ block: { type: "horizontalRule" } });
      } else if (token.name === "pre" && !token.selfClosing) {
        preText = [];
        preLanguage =
          /\blanguage-([\w+-]+)/.exec(token.attrs.class ?? "")?.[1] ?? null;
      } else {
        if (HTML_BLOCK_BREAKS.has(token.name))
          out.push({ paragraphBreak: true });
        if (!token.selfClosing) this.openHtmlElement(stack, token, "block");
      }
    }
    if (preText) out.push({ block: codeBlock(preText.join(""), preLanguage) });
    for (const name of flattened) {
      this.notes.add("html-block-flattened", `<${name}>`);
    }
    return out;
  }

  private dropHidden(raw: string) {
    this.notes.add("hidden-html-dropped", raw);
  }

  private paragraphs(pieces: InlinePiece[]): PMNode[] {
    const out: PMNode[] = [];
    let current: PMNode[] = [];
    let hasText = false;
    let hasBlock = false;
    const flush = () => {
      const content = normalizeInline(current);
      current = [];
      if (content.length) out.push({ type: "paragraph", content });
    };
    for (const piece of pieces) {
      if ("block" in piece) {
        flush();
        out.push(piece.block);
        hasBlock = true;
      } else if ("paragraphBreak" in piece) {
        flush();
      } else {
        if (piece.type !== "text" || piece.text?.trim()) hasText = true;
        current.push(piece);
      }
    }
    flush();
    if (hasBlock && hasText) {
      const image = out.find((node) => node.type === "image");
      this.notes.add(
        "inline-image-moved-to-own-line",
        String(image?.attrs?.alt || image?.attrs?.src || "image"),
      );
    }
    return out;
  }

  private link(
    url: string,
    title: string | null,
    marks: readonly PMMark[],
    children: (marks: PMMark[]) => InlinePiece[],
  ): InlinePiece[] {
    const mark = this.linkMark(url, title);
    const pieces = children(mark ? [...marks, mark] : [...marks]);
    if (
      mark &&
      pieces.length > 0 &&
      pieces.every((piece) => "block" in piece || "paragraphBreak" in piece)
    ) {
      this.notes.add("link-removed", url);
    }
    return pieces;
  }

  private linkMark(url: string, title: string | null): PMMark | null {
    if (title) this.notes.add("link-title-dropped", title);
    const href = importedLinkHref(this.sourcePath, url, this.notes, (slot) =>
      this.slot(slot),
    );
    return href === null ? null : { type: "link", attrs: { href } };
  }

  /** An image can't carry a link, so an image inside `<a>` loses the link. */
  private htmlImagePiece(
    token: Extract<HtmlToken, { type: "open" }>,
    stack: readonly HtmlStackEntry[],
  ): InlinePiece {
    const link = findLastIndex(stack, (entry) => entry.mark?.type === "link");
    if (link !== -1) this.notes.add("link-removed", stack[link].href);
    return { block: this.htmlImage(token) };
  }

  private htmlImage(token: Extract<HtmlToken, { type: "open" }>): PMNode {
    return this.image(
      token.attrs.src ?? "",
      token.attrs.alt ?? "",
      token.attrs.title ?? null,
    );
  }

  private image(url: string, alt: string, title: string | null): PMNode {
    let label = alt;
    if (title) {
      if (!label) label = title;
      else this.notes.add("image-title-dropped", title);
    }
    const reference = classifyImportReference(this.sourcePath, url);
    const written =
      reference.kind === "data-url"
        ? describeDataUrl(reference.url)
        : url || label;
    const src =
      reference.kind === "remote"
        ? reference.url
        : this.slot({ role: "asset", reference, written });
    return { type: "image", attrs: { src, alt: label } };
  }

  private slot(slot: ImportReferenceSlot): string {
    this.slots.push(slot);
    return `${this.referencePrefix}${this.slots.length - 1}`;
  }

  private sourceSlice(node: Nodes): string {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    return typeof start === "number" && typeof end === "number"
      ? this.source.slice(start, end)
      : "";
  }
}

/**
 * The href an imported link keeps, or null when only its text survives. Both
 * readers go through here so neither can keep a scheme the other drops.
 */
function importedLinkHref(
  sourcePath: string,
  written: string,
  notes: ImportNoteBag,
  slot: (value: ImportReferenceSlot) => string,
): string | null {
  const reference = classifyImportReference(sourcePath, written);
  switch (reference.kind) {
    case "remote":
    case "anchor":
      return reference.url;
    case "relative":
      return slot({ role: "link", reference, written });
    case "outside":
      notes.add("link-target-not-imported", written);
      return written;
    case "data-url":
      notes.add("link-removed", describeDataUrl(reference.url));
      return null;
    case "unsupported":
      notes.add("link-removed", written);
      return null;
  }
}

const URL_ATTRIBUTES = ["src", "url", "href"] as const;

/**
 * Keeps a url attribute only when it is safe to store as written: data URLs
 * and unsafe schemes are removed, and paths to other files stay as links
 * that aren't imported.
 */
function withCheckedUrls(
  sourcePath: string,
  attrs: Record<string, unknown>,
  notes: ImportNoteBag,
): Record<string, unknown> {
  const checked = { ...attrs };
  for (const key of URL_ATTRIBUTES) {
    const written = checked[key];
    if (typeof written !== "string" || !written) continue;
    const reference = classifyImportReference(sourcePath, written);
    if (reference.kind === "relative" || reference.kind === "outside") {
      notes.add("link-target-not-imported", written);
    } else if (reference.kind === "data-url") {
      notes.add("unsupported-markdown", describeDataUrl(reference.url));
      delete checked[key];
    } else if (reference.kind === "unsupported") {
      notes.add("link-removed", written);
      delete checked[key];
    }
  }
  return checked;
}

/**
 * Splits HTML at the `</details>` that closes the toggle open before it,
 * skipping toggles opened and closed inside. With no such tag, returns how
 * many toggles are still open after the HTML.
 */
function splitAtDetailsClose(
  html: string,
  depth: number,
): { before: string; after: string } | { depth: number } {
  for (const match of html.matchAll(/<(\/?)details\b[^<>]*>/gi)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) {
      return {
        before: html.slice(0, match.index),
        after: html.slice(match.index + match[0].length),
      };
    }
  }
  return { depth };
}

/**
 * Reads Content's own stored Markdown with the parser the editor uses, after
 * the same nesting repair Notion push applies.
 */
function convertNfm(
  sourcePath: string,
  body: string,
  notes: ImportNoteBag,
  referencePrefix: string,
): { blocks: PMNode[]; slots: ImportReferenceSlot[] } {
  const doc = nfmToDoc(legacyMarkdownToNfm(indentContainerBodies(body, notes)));
  const slots: ImportReferenceSlot[] = [];
  const slot = (value: ImportReferenceSlot) => {
    slots.push(value);
    return `${referencePrefix}${slots.length - 1}`;
  };
  const visit = (node: PMNode) => {
    if (
      (node.type === "image" ||
        node.type === "video" ||
        node.type === "audio") &&
      typeof node.attrs?.src === "string" &&
      node.attrs.src
    ) {
      // NFM reads `![alt](url "title")` as one source; split the title off.
      const titled = /^(\S+)\s+"([^"]*)"$/.exec(node.attrs.src as string);
      const src = titled ? titled[1] : (node.attrs.src as string);
      if (titled?.[2]) {
        if (node.attrs.alt) notes.add("image-title-dropped", titled[2]);
        else node.attrs = { ...node.attrs, alt: titled[2] };
      }
      node.attrs = { ...node.attrs, src };
      const reference = classifyImportReference(sourcePath, src);
      const written =
        reference.kind === "data-url" ? describeDataUrl(reference.url) : src;
      if (reference.kind !== "remote") {
        node.attrs = {
          ...node.attrs,
          src: slot({ role: "asset", reference, written }),
        };
      }
    } else if (node.attrs) {
      // Other blocks and atoms aren't uploaded; their urls get a link's checks.
      node.attrs = withCheckedUrls(sourcePath, node.attrs, notes);
      if (typeof node.attrs.attrsJson === "string") {
        const tagAttrs = JSON.parse(node.attrs.attrsJson) as Record<
          string,
          unknown
        >;
        node.attrs.attrsJson = JSON.stringify(
          withCheckedUrls(sourcePath, tagAttrs, notes),
        );
      }
    }
    if (node.marks?.length) {
      node.marks = node.marks.flatMap((mark) => {
        const written = mark.attrs?.href;
        if (mark.type !== "link" || typeof written !== "string") return [mark];
        const href = importedLinkHref(sourcePath, written, notes, slot);
        return href === null
          ? []
          : [{ ...mark, attrs: { ...mark.attrs, href } }];
      });
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const block of doc.content) visit(block);
  const blocks =
    doc.content.length === 1 &&
    doc.content[0].type === "paragraph" &&
    !doc.content[0].content?.length
      ? []
      : doc.content;
  return { blocks, slots };
}

const NFM_CONTAINER_OPEN_RE =
  /^(\t*)<(callout|details|columns|column|synced_block|synced_block_reference)\b[^>]*>\s*$/;

/**
 * Each repaired container adds a tab to every line inside it, so a run of
 * untabbed opening tags would grow the text quadratically. Bodies nested
 * deeper than this are left as written.
 */
const MAX_REPAIRED_NESTING = 16;

/**
 * NFM nests a container's body one tab deeper than its tags, and the parser
 * drops an untabbed body. Hand-written and agent-written NFM often omits the
 * tab, so indent such a body before parsing instead of losing it.
 */
function indentContainerBodies(nfm: string, notes: ImportNoteBag): string {
  // `base` is the tabs added to the container's own tags; `shift` is the
  // extra tab its body needs, decided at the body's first line.
  const stack: Array<{
    tag: string;
    indent: number;
    base: number;
    shift: number | null;
  }> = [];
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of nfm.split("\n")) {
    const tabs = /^\t*/.exec(line)?.[0].length ?? 0;
    const trimmed = line.trim();
    const top = stack[stack.length - 1];

    if (!fence && top && trimmed === `</${top.tag}>` && tabs === top.indent) {
      stack.pop();
      out.push("\t".repeat(top.base) + line);
      continue;
    }
    if (
      !fence &&
      top &&
      top.shift === null &&
      trimmed &&
      !(top.tag === "details" && trimmed.startsWith("<summary"))
    ) {
      const untabbed = tabs <= top.indent;
      top.shift = untabbed && top.base < MAX_REPAIRED_NESTING ? 1 : 0;
      if (untabbed && top.shift === 0) {
        notes.add("unsupported-markdown", `<${top.tag}>`);
      }
    }
    const isSummary =
      !fence && top?.tag === "details" && trimmed.startsWith("<summary");
    const added = top ? top.base + (isSummary ? 0 : (top.shift ?? 0)) : 0;
    out.push("\t".repeat(added) + line);

    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (trimmed.startsWith(fence)) fence = null;
      continue;
    }
    if (fence) continue;
    const open = NFM_CONTAINER_OPEN_RE.exec(line);
    if (open) {
      stack.push({ tag: open[2], indent: tabs, base: added, shift: null });
    }
  }
  return out.join("\n");
}

/** Visits nodes in document order, without recursion: nesting can be deep. */
function walk(root: Nodes, visit: (node: Nodes) => void) {
  const pending: Nodes[] = [root];
  for (let node = pending.pop(); node; node = pending.pop()) {
    visit(node);
    if ("children" in node) {
      const children = node.children as Nodes[];
      for (let index = children.length - 1; index >= 0; index--) {
        pending.push(children[index]);
      }
    }
  }
}

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase().replace(/\s+/g, " ");
}

function textNode(text: string, marks: readonly PMMark[]): PMNode {
  const sorted = sortMarks(marks);
  return sorted.length
    ? { type: "text", text, marks: sorted }
    : { type: "text", text };
}

function sortMarks(marks: readonly PMMark[]): PMMark[] {
  const seen = new Set<string>();
  const out: PMMark[] = [];
  for (const mark of marks) {
    if (seen.has(mark.type)) continue;
    seen.add(mark.type);
    out.push(mark);
  }
  return out.sort(
    (a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type),
  );
}

function normalizeInline(nodes: readonly PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      if (!node.text) continue;
      const previous = out[out.length - 1];
      if (
        previous?.type === "text" &&
        JSON.stringify(previous.marks ?? []) ===
          JSON.stringify(node.marks ?? [])
      ) {
        out[out.length - 1] = {
          ...previous,
          text: `${previous.text}${node.text}`,
        };
        continue;
      }
    }
    out.push({ ...node });
  }
  const isEdge = (node: PMNode | undefined) =>
    node?.type === "hardBreak" || (node?.type === "text" && !node.text?.trim());
  while (isEdge(out[0])) out.shift();
  while (isEdge(out[out.length - 1])) out.pop();
  const first = out[0];
  if (first?.type === "text") first.text = first.text?.trimStart();
  const last = out[out.length - 1];
  // Not `/\s+$/`: it rescans every run of spaces that isn't at the end.
  if (last?.type === "text") last.text = last.text?.trimEnd();
  return out;
}

function withLeadingParagraph(blocks: PMNode[]): PMNode[] {
  return blocks[0]?.type === "paragraph"
    ? blocks
    : [{ type: "paragraph" }, ...blocks];
}

function equation(latex: string): PMNode {
  return {
    type: "notionBlockAtom",
    attrs: { tagName: "equation", attrsJson: "{}", label: latex },
  };
}

/**
 * Joins soft-wrapped lines with one space. A `[ \t]*\n` regex would rescan
 * every run of spaces that has no newline after it.
 */
function joinSoftBreaks(value: string): string {
  const lines = value.split("\n");
  return lines
    .map((line, index) => {
      let start = 0;
      let end = line.length;
      if (index > 0) {
        while (start < end && (line[start] === " " || line[start] === "\t")) {
          start += 1;
        }
      }
      if (index < lines.length - 1) {
        while (
          end > start &&
          (line[end - 1] === " " || line[end - 1] === "\t")
        ) {
          end -= 1;
        }
      }
      return line.slice(start, end);
    })
    .join(" ");
}

function codeBlock(text: string, language: string | null): PMNode {
  const value = text.replace(/^\n/, "").replace(/\n$/, "");
  return {
    type: "codeBlock",
    attrs: { language },
    content: value ? [{ type: "text", text: value }] : [],
  };
}

function inlinePlainText(nodes: readonly PMNode[]): string {
  return nodes
    .map((node) =>
      node.type === "text"
        ? (node.text ?? "")
        : node.type === "notionInlineAtom"
          ? String(node.attrs?.label ?? "")
          : " ",
    )
    .join("");
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function listItemLabel(item: ListItem, source: string): string {
  const start = item.position?.start?.offset;
  const end = item.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return "list";
  return source.slice(start, end).split("\n")[0] ?? "list";
}

/**
 * `$5 and $10` is two prices, not math. Following Pandoc, single-dollar math
 * may not start or end with whitespace or be followed by a digit.
 */
function isDollarAmountPair(
  raw: string,
  value: string,
  source: string,
  end: number | undefined,
): boolean {
  if (!raw.startsWith("$") || raw.startsWith("$$")) return false;
  if (/^\s|\s$/.test(value)) return true;
  return typeof end === "number" && /\d/.test(source[end] ?? "");
}

function describeDataUrl(url: string): string {
  const mediaType = /^data:([^;,]+)/i.exec(url)?.[1] ?? "data";
  const kilobytes = Math.max(1, Math.round((url.length * 3) / 4 / 1024));
  return `${mediaType} (${kilobytes} KB, embedded)`;
}

function findLastIndex<T>(items: readonly T[], match: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index--) {
    if (match(items[index])) return index;
  }
  return -1;
}
