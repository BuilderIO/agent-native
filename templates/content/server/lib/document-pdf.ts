import { readFileSync } from "node:fs";
import path from "node:path";

import { resolveOgFontFiles } from "@agent-native/core/server";
import { jsPDF } from "jspdf";

import { nfmToDoc, type PMMark, type PMNode } from "../../shared/nfm.js";
import {
  SPECTRAL_BOLD_BASE64,
  SPECTRAL_BOLD_ITALIC_BASE64,
  SPECTRAL_ITALIC_BASE64,
  SPECTRAL_REGULAR_BASE64,
} from "./spectral-fonts.generated.js";

export type Rgb = readonly [number, number, number];

export interface PdfFont {
  mono: boolean;
  bold: boolean;
  italic: boolean;
  size: number;
}

export interface PdfCanvas {
  readonly width: number;
  readonly height: number;
  readonly page: number;
  readonly pageCount: number;
  addPage(): void;
  setPage(page: number): void;
  measure(text: string, font: PdfFont): number;
  text(
    text: string,
    x: number,
    baseline: number,
    font: PdfFont,
    color: Rgb,
  ): void;
  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: Rgb,
    width: number,
  ): void;
  fill(x: number, y: number, width: number, height: number, color: Rgb): void;
  link(x: number, y: number, width: number, height: number, url: string): void;
}

export const PDF_MAX_PAGES = 200;

export type PdfTooLongReason = "pages" | "table" | "text";

const TOO_LONG_DETAILS: Record<PdfTooLongReason, string> = {
  pages: `The page runs past ${PDF_MAX_PAGES} PDF pages.`,
  table: "The page has a table with too many columns to draw.",
  text: "The page has more text to draw than a PDF attachment allows.",
};

export class PdfTooLongError extends Error {
  readonly reason: PdfTooLongReason;

  constructor(reason: PdfTooLongReason) {
    super(TOO_LONG_DETAILS[reason]);
    this.name = "PdfTooLongError";
    this.reason = reason;
  }
}

export type PdfFontFamily = "sans" | "serif";

const MARGIN = 54;
const BODY_SIZE = 11;
const SERIF_BODY_SIZE = 12;
const LINE_HEIGHT = 1.5;
const TITLE_GAP = 24;
const HEADING_ABOVE = 0.9;
const HEADING_BELOW = 0.25;
const KEEP_LINES = 8;
const INDENT = 18;
const MIN_TEXT_WIDTH = 72;
const CODE_SIZE = 9.5;
const TABLE_SIZE = 9.5;
const MIN_CELL_TEXT_WIDTH = 14;
const ITALIC_SKEW = 0.2;
const HEADING_SIZES = new Map([
  [1, 24],
  [2, 18],
  [3, 15],
  [4, 13],
  [5, 12],
  [6, 11],
]);
const BULLETS = "•–•";

const TEXT: Rgb = [38, 38, 38];
const MUTED: Rgb = [115, 115, 115];
const QUOTE: Rgb = [82, 82, 82];
const LINK: Rgb = [37, 99, 235];
const RULE: Rgb = [212, 212, 212];
const CODE_FILL: Rgb = [244, 244, 244];

const NAMED_COLORS = new Map<string, Rgb>([
  ["gray", [120, 119, 116]],
  ["brown", [159, 107, 83]],
  ["orange", [217, 115, 13]],
  ["yellow", [203, 145, 47]],
  ["green", [68, 131, 97]],
  ["blue", [51, 126, 169]],
  ["purple", [144, 101, 176]],
  ["pink", [193, 76, 138]],
  ["red", [212, 76, 71]],
]);

interface TextStyle {
  bold: boolean;
  italic: boolean;
  code: boolean;
  strike: boolean;
  underline: boolean;
  color: Rgb | null;
  href: string | null;
}

type Inline =
  | { kind: "text"; text: string; style: TextStyle }
  | { kind: "break" };

interface Piece {
  text: string;
  style: TextStyle;
  font: PdfFont;
  width: number;
  space: boolean;
}

interface Line {
  pieces: Piece[];
  width: number;
}

interface Box {
  x: number;
  width: number;
  color: Rgb;
  depth: number;
}

type FirstLine = (top: number, lineHeight: number) => void;

const PLAIN: TextStyle = {
  bold: false,
  italic: false,
  code: false,
  strike: false,
  underline: false,
  color: null,
  href: null,
};

function inset(box: Box, by: number): Box {
  const shift = Math.max(Math.min(by, box.width - MIN_TEXT_WIDTH), 0);
  return { ...box, x: box.x + shift, width: box.width - shift };
}

function itemAt<T>(items: readonly T[], index: number): T | undefined {
  return index >= 0 && index < items.length ? items[index] : undefined;
}

function lastOf<T>(items: readonly T[]): T | undefined {
  return itemAt(items, items.length - 1);
}

function plainText(nodes: readonly PMNode[] | undefined) {
  return inlinesOf(nodes, PLAIN)
    .map((inline) => (inline.kind === "text" ? inline.text : " "))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function namedColor(value: unknown): Rgb | null {
  if (typeof value !== "string") return null;
  return NAMED_COLORS.get(value.replace(/_bg$/, "")) ?? null;
}

function linkUrl(value: unknown): string | null {
  if (typeof value !== "string" || !URL.canParse(value)) return null;
  const url = new URL(value);
  return ["http:", "https:", "mailto:"].includes(url.protocol)
    ? url.href
    : null;
}

function atomAttrs(node: PMNode): Record<string, unknown> {
  const raw: unknown = node.attrs?.attrsJson;
  if (typeof raw !== "string") return {};
  const parsed: unknown = JSON.parse(raw);
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function atomText(node: PMNode): string {
  const attrs = atomAttrs(node);
  return firstString(node.attrs?.label, attrs.start, attrs.url);
}

function styleFor(marks: readonly PMMark[] | undefined, base: TextStyle) {
  let style = base;
  for (const mark of marks ?? []) {
    if (mark.type === "bold") style = { ...style, bold: true };
    else if (mark.type === "italic") style = { ...style, italic: true };
    else if (mark.type === "strike") style = { ...style, strike: true };
    else if (mark.type === "code") style = { ...style, code: true };
    else if (mark.type === "underline") style = { ...style, underline: true };
    else if (mark.type === "link") {
      style = { ...style, href: linkUrl(mark.attrs?.href) ?? style.href };
    } else if (mark.type === "notionSpan") {
      style = {
        ...style,
        color: namedColor(mark.attrs?.color) ?? style.color,
        underline: style.underline || Boolean(mark.attrs?.underline),
        href: linkUrl(mark.attrs?.href) ?? style.href,
      };
    }
  }
  return style;
}

function inlinesOf(
  nodes: readonly PMNode[] | undefined,
  base: TextStyle,
): Inline[] {
  const inlines: Inline[] = [];
  for (const node of nodes ?? []) {
    const style = styleFor(node.marks, base);
    if (node.type === "hardBreak") {
      inlines.push({ kind: "break" });
    } else if (node.type === "notionInlineAtom") {
      const text = atomText(node);
      if (text) {
        inlines.push({
          kind: "text",
          text,
          style:
            node.attrs?.tagName === "math" ? { ...style, code: true } : style,
        });
      }
    } else if (node.content) {
      inlines.push(...inlinesOf(node.content, style));
    } else if (node.text) {
      const lines = node.text.split("\n");
      lines.forEach((text, index) => {
        if (index > 0) inlines.push({ kind: "break" });
        if (text) inlines.push({ kind: "text", text, style });
      });
    }
  }
  return inlines;
}

function flattenInlines(nodes: readonly PMNode[] | undefined): Inline[] {
  const inlines: Inline[] = [];
  const push = (items: Inline[]) => {
    if (!items.length) return;
    if (inlines.length) inlines.push({ kind: "break" });
    inlines.push(...items);
  };
  for (const node of nodes ?? []) {
    if (node.type === "paragraph" || node.type === "heading") {
      push(inlinesOf(node.content, PLAIN));
    } else if (node.type === "listItem" || node.type === "taskItem") {
      const items = flattenInlines(node.content);
      push(
        items.length
          ? [{ kind: "text", text: "• ", style: PLAIN }, ...items]
          : [],
      );
    } else if (node.content) {
      push(flattenInlines(node.content));
    } else {
      const text = placeholderText(node);
      if (text) push([{ kind: "text", text, style: PLAIN }]);
    }
  }
  return inlines;
}

function placeholderText(node: PMNode): string {
  const attrs = node.attrs ?? {};
  if (node.type === "notionBlockAtom" || node.type === "notionInlineAtom") {
    return node.attrs?.tagName === "table_of_contents" ? "" : atomText(node);
  }
  const name = firstString(
    attrs.title,
    attrs.alt,
    attrs.label,
    attrs.name,
    attrs.sourcePath,
    attrs.src,
  );
  if (node.type === "image") return `Image: ${name || "untitled"}`;
  if (node.type === "registryBlock" || node.type === "contentReference") {
    return name;
  }
  return name
    ? `${node.type.charAt(0).toUpperCase()}${node.type.slice(1)}: ${name}`
    : "";
}

function fontFor(style: TextStyle, size: number, bold: boolean): PdfFont {
  return {
    mono: style.code,
    bold: bold || style.bold,
    italic: style.italic,
    size: style.code ? size * 0.92 : size,
  };
}

function sameStyle(a: TextStyle, b: TextStyle) {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.code === b.code &&
    a.strike === b.strike &&
    a.underline === b.underline &&
    a.color === b.color &&
    a.href === b.href
  );
}

class PdfLayout {
  y = MARGIN;

  constructor(
    private readonly canvas: PdfCanvas,
    private readonly body: number,
    private readonly title: PMNode | undefined,
  ) {}

  private get bottom() {
    return this.canvas.height - MARGIN;
  }

  private headingSize(level: unknown) {
    const clamped = Math.min(Math.max(Number(level) || 1, 1), 6);
    return Math.max(HEADING_SIZES.get(clamped) ?? this.body, this.body);
  }

  private indented(node: PMNode, box: Box) {
    const indent = Number(node.attrs?.indent);
    return Number.isInteger(indent) && indent > 0
      ? inset(box, Math.min(indent * INDENT, box.width / 2))
      : box;
  }

  private newPage() {
    if (this.canvas.pageCount >= PDF_MAX_PAGES) {
      throw new PdfTooLongError("pages");
    }
    this.canvas.addPage();
    this.y = MARGIN;
  }

  private room(height: number) {
    if (this.y + height > this.bottom && this.y > MARGIN) this.newPage();
  }

  private gap(height: number) {
    if (this.y > MARGIN) this.y += height;
  }

  breakLines(
    inlines: readonly Inline[],
    width: number,
    size: number,
    bold: boolean,
  ): Line[] {
    const lines: Line[] = [];
    let pieces: Piece[] = [];
    let lineWidth = 0;
    let wrapNext = false;
    const hasText = () => pieces.some((piece) => !piece.space);
    const finish = () => {
      let last = lastOf(pieces);
      while (last?.space) {
        pieces.pop();
        lineWidth -= last.width;
        last = lastOf(pieces);
      }
      if (last && /\s$/.test(last.text)) {
        const text = last.text.trimEnd();
        const width = this.canvas.measure(text, last.font);
        lineWidth -= last.width - width;
        last.text = text;
        last.width = width;
      }
      lines.push({ pieces, width: lineWidth });
      pieces = [];
      lineWidth = 0;
    };
    const add = (text: string, style: TextStyle, font: PdfFont) => {
      const width = this.canvas.measure(text, font);
      const space = !text.trim();
      const last = lastOf(pieces);
      if (last && sameStyle(last.style, style)) {
        last.text += text;
        last.width += width;
        last.space = last.space && space;
      } else {
        pieces.push({ text, style, font, width, space });
      }
      lineWidth += width;
    };
    for (const inline of inlines) {
      if (inline.kind === "break") {
        finish();
        wrapNext = false;
        continue;
      }
      const font = fontFor(inline.style, size, bold);
      for (const token of inline.text.replace(/\t/g, "    ").split(/(\s+)/)) {
        if (!token) continue;
        const tokenWidth = this.canvas.measure(token, font);
        if (!token.trim()) {
          if (!wrapNext && lineWidth + tokenWidth <= width) {
            add(token, inline.style, font);
          } else if (hasText()) {
            wrapNext = true;
          }
          continue;
        }
        if (wrapNext || lineWidth + tokenWidth > width) {
          wrapNext = false;
          if (hasText()) {
            finish();
          } else {
            pieces = [];
            lineWidth = 0;
          }
        }
        if (tokenWidth <= width) {
          add(token, inline.style, font);
          continue;
        }
        let chunk = "";
        let chunkWidth = 0;
        for (const character of token) {
          const characterWidth = this.canvas.measure(character, font);
          if (chunk && lineWidth + chunkWidth + characterWidth > width) {
            add(chunk, inline.style, font);
            finish();
            chunk = "";
            chunkWidth = 0;
          }
          chunk += character;
          chunkWidth += characterWidth;
        }
        if (chunk) add(chunk, inline.style, font);
      }
    }
    if (pieces.length || !lines.length) finish();
    return lines.length === 1 && !lastOf(lines)?.pieces.length ? [] : lines;
  }

  drawLine(
    line: Line,
    x: number,
    top: number,
    size: number,
    lineHeight: number,
    color: Rgb,
  ) {
    const baseline = top + (lineHeight - size) / 2 + size * 0.8;
    let cursor = x;
    for (const piece of line.pieces) {
      const pieceColor = piece.style.href ? LINK : (piece.style.color ?? color);
      if (piece.style.code && !piece.space) {
        this.canvas.fill(
          cursor - 1.5,
          baseline - size * 0.82,
          piece.width + 3,
          size * 1.12,
          CODE_FILL,
        );
      }
      this.canvas.text(piece.text, cursor, baseline, piece.font, pieceColor);
      if (piece.style.underline || piece.style.href) {
        this.canvas.line(
          cursor,
          baseline + 1.4,
          cursor + piece.width,
          baseline + 1.4,
          pieceColor,
          0.5,
        );
      }
      if (piece.style.strike) {
        this.canvas.line(
          cursor,
          baseline - size * 0.3,
          cursor + piece.width,
          baseline - size * 0.3,
          pieceColor,
          0.6,
        );
      }
      if (piece.style.href && !piece.space) {
        this.canvas.link(
          cursor,
          top,
          piece.width,
          lineHeight,
          piece.style.href,
        );
      }
      cursor += piece.width;
    }
  }

  paragraph(
    inlines: readonly Inline[],
    box: Box,
    options: {
      size?: number;
      bold?: boolean;
      color?: Rgb;
      keep?: number | undefined;
    },
    onFirstLine?: FirstLine,
  ) {
    const size = options.size ?? this.body;
    const lineHeight = size * LINE_HEIGHT;
    const lines = this.breakLines(
      inlines,
      box.width,
      size,
      Boolean(options.bold),
    );
    if (lines.length <= KEEP_LINES) {
      this.room(lines.length * lineHeight + (options.keep ?? 0));
    }
    if (!lines.length) {
      this.room(lineHeight);
      onFirstLine?.(this.y, lineHeight);
      this.y += lineHeight;
      return;
    }
    lines.forEach((line, index) => {
      this.room(lineHeight);
      if (index === 0) onFirstLine?.(this.y, lineHeight);
      this.drawLine(
        line,
        box.x,
        this.y,
        size,
        lineHeight,
        options.color ?? box.color,
      );
      this.y += lineHeight;
    });
  }

  private withBar(
    box: Box,
    color: Rgb,
    render: (inner: Box, onFirstLine: FirstLine) => void,
  ) {
    const starts: Array<{ page: number; y: number }> = [];
    render(inset(box, 14), (top) => {
      if (!starts.length) starts.push({ page: this.canvas.page, y: top });
    });
    const start = itemAt(starts, 0);
    if (!start) return;
    const endPage = this.canvas.page;
    const endY = this.y;
    for (let page = start.page; page <= endPage; page++) {
      this.canvas.setPage(page);
      const top = page === start.page ? start.y : MARGIN;
      const bottom = page === endPage ? endY : this.bottom;
      if (bottom > top) {
        this.canvas.line(box.x + 1.5, top, box.x + 1.5, bottom, color, 2.5);
      }
    }
    this.canvas.setPage(endPage);
  }

  private codeBlock(source: string, box: Box, onFirstLine?: FirstLine) {
    const font: PdfFont = {
      mono: true,
      bold: false,
      italic: false,
      size: CODE_SIZE,
    };
    const lineHeight = CODE_SIZE * 1.45;
    const padding = 8;
    const width = box.width - padding * 2;
    const rows: string[] = [];
    for (const sourceLine of source.replace(/\t/g, "    ").split("\n")) {
      let row = "";
      let rowWidth = 0;
      for (const character of sourceLine) {
        const characterWidth = this.canvas.measure(character, font);
        if (row && rowWidth + characterWidth > width) {
          rows.push(row);
          row = "";
          rowWidth = 0;
        }
        row += character;
        rowWidth += characterWidth;
      }
      rows.push(row);
    }
    this.room(lineHeight + padding * 2);
    onFirstLine?.(this.y, lineHeight + padding * 2);
    this.canvas.fill(box.x, this.y, box.width, padding, CODE_FILL);
    this.y += padding;
    for (const [index, row] of rows.entries()) {
      this.room(index === rows.length - 1 ? lineHeight + padding : lineHeight);
      this.canvas.fill(box.x, this.y, box.width, lineHeight, CODE_FILL);
      if (row) {
        this.canvas.text(
          row,
          box.x + padding,
          this.y + (lineHeight - CODE_SIZE) / 2 + CODE_SIZE * 0.8,
          font,
          box.color,
        );
      }
      this.y += lineHeight;
    }
    this.canvas.fill(box.x, this.y, box.width, padding, CODE_FILL);
    this.y += padding;
  }

  private list(node: PMNode, box: Box, onFirstLine?: FirstLine) {
    const items = node.content ?? [];
    const start = Number(node.attrs?.start);
    const first = Number.isInteger(start) ? start : 1;
    const font: PdfFont = {
      mono: false,
      bold: false,
      italic: false,
      size: this.body,
    };
    const markers = items.map((_, index) =>
      node.type === "orderedList"
        ? `${first + index}.`
        : node.type === "bulletList"
          ? BULLETS.charAt(box.depth % BULLETS.length)
          : "",
    );
    const widths = markers.map((marker) => this.canvas.measure(marker, font));
    const indent = Math.max(
      Math.min(
        widths.reduce((widest, width) => Math.max(widest, width + 6), INDENT),
        box.width - MIN_TEXT_WIDTH,
      ),
      0,
    );
    const inner: Box = {
      ...box,
      x: box.x + indent,
      width: box.width - indent,
      depth: box.depth + 1,
    };
    items.forEach((item, index) => {
      if (index > 0) this.gap(2);
      const marker = itemAt(markers, index) ?? "";
      const width = itemAt(widths, index) ?? 0;
      const checked =
        node.type === "taskList" ? Boolean(item.attrs?.checked) : null;
      this.blocks(item.content ?? [], inner, (top, lineHeight) => {
        if (index === 0) onFirstLine?.(top, lineHeight);
        if (checked !== null) {
          this.checkbox(box.x + 3, top + (lineHeight - 8) / 2, checked);
          return;
        }
        this.canvas.text(
          marker,
          box.x + indent - 6 - width,
          top + (lineHeight - this.body) / 2 + this.body * 0.8,
          font,
          box.color,
        );
      });
    });
  }

  private checkbox(x: number, y: number, checked: boolean) {
    const size = 8;
    if (checked) {
      this.canvas.fill(x, y, size, size, QUOTE);
      this.canvas.line(
        x + 1.8,
        y + 4.2,
        x + 3.4,
        y + 5.8,
        [255, 255, 255],
        1.1,
      );
      this.canvas.line(
        x + 3.4,
        y + 5.8,
        x + 6.4,
        y + 2.4,
        [255, 255, 255],
        1.1,
      );
      return;
    }
    this.canvas.line(x, y, x + size, y, MUTED, 0.8);
    this.canvas.line(x + size, y, x + size, y + size, MUTED, 0.8);
    this.canvas.line(x + size, y + size, x, y + size, MUTED, 0.8);
    this.canvas.line(x, y + size, x, y, MUTED, 0.8);
  }

  private table(node: PMNode, box: Box, onFirstLine?: FirstLine) {
    const rows = node.content ?? [];
    const columns = rows.reduce(
      (widest, row) => Math.max(widest, row.content?.length ?? 0),
      0,
    );
    if (!columns) return;
    const columnWidth = box.width / columns;
    const lineHeight = TABLE_SIZE * 1.4;
    const padding = 4;
    if (columnWidth - padding * 2 < MIN_CELL_TEXT_WIDTH) {
      throw new PdfTooLongError("table");
    }
    rows.forEach((row, rowIndex) => {
      const cells = row.content ?? [];
      const cellLines = Array.from({ length: columns }, (_, column) => {
        const cell = itemAt(cells, column);
        const header =
          cell?.type === "tableHeader" ||
          (rowIndex === 0 && Boolean(node.attrs?.headerRow)) ||
          (column === 0 && Boolean(node.attrs?.headerColumn));
        return this.breakLines(
          flattenInlines(cell?.content),
          columnWidth - padding * 2,
          TABLE_SIZE,
          header,
        );
      });
      const lineCount = cellLines.reduce(
        (most, lines) => Math.max(most, lines.length),
        1,
      );
      this.room(lineHeight + padding * 2);
      if (rowIndex === 0) onFirstLine?.(this.y, lineHeight + padding * 2);
      let segmentTop = this.y;
      const borders = (bottom: number) => {
        this.canvas.line(
          box.x,
          segmentTop,
          box.x + box.width,
          segmentTop,
          RULE,
          0.6,
        );
        this.canvas.line(box.x, bottom, box.x + box.width, bottom, RULE, 0.6);
        for (let column = 0; column <= columns; column++) {
          const x = box.x + column * columnWidth;
          this.canvas.line(x, segmentTop, x, bottom, RULE, 0.6);
        }
      };
      this.y += padding;
      for (let index = 0; index < lineCount; index++) {
        const below = index === lineCount - 1 ? padding : 0;
        if (this.y + lineHeight + below > this.bottom) {
          borders(this.y);
          this.newPage();
          segmentTop = this.y;
        }
        cellLines.forEach((lines, column) => {
          const line = itemAt(lines, index);
          if (line) {
            this.drawLine(
              line,
              box.x + column * columnWidth + padding,
              this.y,
              TABLE_SIZE,
              lineHeight,
              box.color,
            );
          }
        });
        this.y += lineHeight;
      }
      this.y += padding;
      borders(this.y);
    });
  }

  private headingBelow(node: PMNode) {
    return node === this.title
      ? TITLE_GAP
      : this.headingSize(node.attrs?.level) * HEADING_BELOW;
  }

  private keepAfter(nodes: readonly PMNode[], index: number, box: Box) {
    const most = (this.bottom - MARGIN) / 2;
    const heading = itemAt(nodes, index);
    let height = (heading ? this.headingBelow(heading) : 0) + this.body;
    let offset = 1;
    let next = itemAt(nodes, index + offset);
    while (next?.type === "heading" && height < most) {
      const size = this.headingSize(next.attrs?.level);
      const lines = this.breakLines(
        inlinesOf(next.content, PLAIN),
        this.indented(next, box).width,
        size,
        true,
      ).length;
      height +=
        size *
          (Math.max(lines, 1) * LINE_HEIGHT + HEADING_ABOVE + HEADING_BELOW) +
        this.body;
      offset += 1;
      next = itemAt(nodes, index + offset);
    }
    const lines =
      next?.type === "paragraph"
        ? this.breakLines(
            inlinesOf(next.content, PLAIN),
            this.indented(next, box).width,
            this.body,
            false,
          ).length
        : 0;
    height +=
      this.body * LINE_HEIGHT * (lines > 0 && lines <= KEEP_LINES ? lines : 2);
    return Math.min(height, most);
  }

  private block(
    node: PMNode,
    box: Box,
    onFirstLine?: FirstLine,
    keep?: number,
  ) {
    const shifted = this.indented(node, box);
    if (node.type === "paragraph") {
      this.paragraph(inlinesOf(node.content, PLAIN), shifted, {}, onFirstLine);
      return;
    }
    if (node.type === "heading") {
      const size = this.headingSize(node.attrs?.level);
      this.gap(size * HEADING_ABOVE);
      this.paragraph(
        inlinesOf(node.content, PLAIN),
        shifted,
        { size, bold: true, keep },
        onFirstLine,
      );
      this.y += this.headingBelow(node);
      return;
    }
    const bare = () => {
      this.room(this.body * LINE_HEIGHT);
      onFirstLine?.(this.y, this.body * LINE_HEIGHT);
    };
    const alongside =
      (first: FirstLine): FirstLine =>
      (top, lineHeight) => {
        first(top, lineHeight);
        onFirstLine?.(top, lineHeight);
      };
    if (
      node.type === "bulletList" ||
      node.type === "orderedList" ||
      node.type === "taskList"
    ) {
      this.list(node, shifted, onFirstLine);
    } else if (node.type === "blockquote") {
      this.withBar(shifted, RULE, (inner, first) =>
        this.blocks(
          node.content ?? [],
          { ...inner, color: QUOTE },
          alongside(first),
        ),
      );
    } else if (node.type === "notionCallout") {
      this.withBar(
        shifted,
        namedColor(node.attrs?.color) ?? RULE,
        (inner, first) =>
          this.blocks(node.content ?? [], inner, alongside(first)),
      );
    } else if (node.type === "codeBlock") {
      this.codeBlock(
        (node.content ?? []).map((child) => child.text ?? "").join(""),
        shifted,
        onFirstLine,
      );
    } else if (
      node.type === "notionBlockAtom" &&
      node.attrs?.tagName === "equation"
    ) {
      this.codeBlock(atomText(node), shifted, onFirstLine);
    } else if (node.type === "horizontalRule") {
      bare();
      this.gap(6);
      this.canvas.line(
        shifted.x,
        this.y,
        shifted.x + shifted.width,
        this.y,
        RULE,
        0.8,
      );
      this.y += 6;
    } else if (node.type === "table") {
      this.table(node, shifted, onFirstLine);
    } else if (node.type === "notionToggle") {
      const content = node.content ?? [];
      const first = itemAt(content, 0);
      const summary: unknown = node.attrs?.summary;
      const title: Inline[] =
        first?.type === "notionToggleSummary"
          ? inlinesOf(first.content, PLAIN)
          : typeof summary === "string" && summary.trim()
            ? [{ kind: "text", text: summary, style: PLAIN }]
            : [];
      const children =
        first?.type === "notionToggleSummary" ? content.slice(1) : content;
      const level = Number(node.attrs?.headingLevel);
      const size =
        Number.isInteger(level) && level >= 1 && level <= 6
          ? this.headingSize(level)
          : null;
      if (title.length) {
        this.paragraph(
          title,
          shifted,
          size ? { size, bold: true } : {},
          onFirstLine,
        );
      }
      if (children.length) {
        this.blocks(
          children,
          inset(shifted, INDENT),
          title.length ? undefined : onFirstLine,
        );
      }
      if (!title.length && !children.length) bare();
    } else if (node.type === "localMdxComponent") {
      const children: unknown = node.attrs?.children;
      if (typeof children === "string" && children.trim()) {
        this.blocks(nfmToDoc(children).content, shifted, onFirstLine);
      } else {
        bare();
      }
    } else if (node.content?.length) {
      this.blocks(node.content, shifted, onFirstLine);
    } else {
      const text = placeholderText(node);
      if (text) {
        const href = linkUrl(node.attrs?.src) ?? linkUrl(atomAttrs(node).url);
        this.paragraph(
          [
            {
              kind: "text",
              text,
              style: {
                ...PLAIN,
                italic: node.type !== "notionBlockAtom",
                color: MUTED,
                href,
              },
            },
          ],
          shifted,
          {},
          onFirstLine,
        );
      } else {
        bare();
      }
    }
  }

  blocks(nodes: readonly PMNode[], box: Box, onFirstLine?: FirstLine) {
    nodes.forEach((node, index) => {
      if (index > 0) this.gap(this.body);
      this.block(
        node,
        box,
        index === 0 ? onFirstLine : undefined,
        node.type === "heading" ? this.keepAfter(nodes, index, box) : undefined,
      );
    });
    if (!nodes.length) {
      this.room(this.body * LINE_HEIGHT);
      onFirstLine?.(this.y, this.body * LINE_HEIGHT);
      this.y += this.body * LINE_HEIGHT;
    }
  }

  pageNumbers() {
    const count = this.canvas.pageCount;
    const font: PdfFont = {
      mono: false,
      bold: false,
      italic: false,
      size: 8.5,
    };
    for (let page = 1; page <= count; page++) {
      this.canvas.setPage(page);
      const label = `${page} / ${count}`;
      this.canvas.text(
        label,
        (this.canvas.width - this.canvas.measure(label, font)) / 2,
        this.canvas.height - MARGIN / 2,
        font,
        MUTED,
      );
    }
  }
}

export function layoutDocumentPdf(
  input: {
    title: string;
    content: string | null | undefined;
    font?: PdfFontFamily | undefined;
  },
  canvas: PdfCanvas,
) {
  const title =
    input.title.normalize("NFC").replace(/\s+/g, " ").trim() || "Untitled";
  const body = nfmToDoc((input.content ?? "").normalize("NFC")).content;
  const first = itemAt(body, 0);
  const titled =
    first?.type === "heading" &&
    Number(first.attrs?.level) === 1 &&
    plainText(first.content).toLowerCase() === title.toLowerCase();
  const heading: PMNode = {
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text: title }],
  };
  const blocks = titled ? body : [heading, ...body];
  const layout = new PdfLayout(
    canvas,
    input.font === "serif" ? SERIF_BODY_SIZE : BODY_SIZE,
    itemAt(blocks, 0),
  );
  layout.blocks(blocks, {
    x: MARGIN,
    width: canvas.width - MARGIN * 2,
    color: TEXT,
    depth: 0,
  });
  layout.pageNumbers();
}

const MAX_TEXT_RUNS = 100_000;
const SANS_FACES = {
  normal: "LiberationSans-Regular",
  bold: "LiberationSans-Bold",
} as const;
const SERIF_FACES = {
  normal: { name: "Spectral-Regular", base64: SPECTRAL_REGULAR_BASE64 },
  italic: { name: "Spectral-Italic", base64: SPECTRAL_ITALIC_BASE64 },
  bold: { name: "Spectral-Bold", base64: SPECTRAL_BOLD_BASE64 },
  bolditalic: {
    name: "Spectral-BoldItalic",
    base64: SPECTRAL_BOLD_ITALIC_BASE64,
  },
} as const;
const RIGHT_TO_LEFT =
  /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/u;
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u;
const EMOJI_PART = /[\p{Emoji_Component}\p{Variation_Selector}]/u;
const SPACE = /\p{Zs}/u;

type Face = "courier" | "sans" | "serif";

interface Run {
  text: string;
  face: Face;
}

export class PdfUnsupportedTextError extends Error {
  constructor() {
    super("The page has text the PDF font can't show.");
    this.name = "PdfUnsupportedTextError";
  }
}

let sansFonts: Record<keyof typeof SANS_FACES, string> | undefined;

function loadSansFonts() {
  if (sansFonts) return sansFonts;
  const files = resolveOgFontFiles() ?? [];
  const read = (name: string) => {
    const file = files.find((candidate) => path.basename(candidate) === name);
    if (!file) throw new Error(`The PDF font ${name} is unavailable.`);
    return readFileSync(file).toString("base64");
  };
  sansFonts = {
    normal: read(`${SANS_FACES.normal}.ttf`),
    bold: read(`${SANS_FACES.bold}.ttf`),
  };
  return sansFonts;
}

function glyphCheck(metadata: unknown) {
  const lookup: unknown =
    metadata && typeof metadata === "object" && "characterToGlyph" in metadata
      ? metadata.characterToGlyph
      : undefined;
  if (typeof lookup !== "function") {
    throw new Error("The PDF font has no character map.");
  }
  return (code: number) => Number(lookup.call(metadata, code)) > 0;
}

function drawableCharacter(character: string, hasGlyph: boolean) {
  if (
    RIGHT_TO_LEFT.test(character) ||
    (!hasGlyph && WORD_CHARACTER.test(character) && !EMOJI_PART.test(character))
  ) {
    throw new PdfUnsupportedTextError();
  }
  if (hasGlyph) return character;
  return SPACE.test(character) ? " " : "";
}

function runsBy(text: string, faceOf: (character: string) => Face) {
  const runs: Run[] = [];
  for (const character of text) {
    const face = faceOf(character);
    const last = lastOf(runs);
    if (last && last.face === face) last.text += character;
    else runs.push({ text: character, face });
  }
  return runs;
}

function courierFace(character: string): Face {
  const code = character.codePointAt(0) ?? 0;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)
    ? "courier"
    : "sans";
}

export function renderDocumentPdf(input: {
  title: string;
  content: string | null | undefined;
  font?: PdfFontFamily | undefined;
}): Buffer {
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  doc.setProperties({ title: input.title, creator: "Agent-Native Content" });
  const serif = input.font === "serif";
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const added = new Set<string>();
  const setFace = (name: string, base64: () => string) => {
    if (!added.has(name)) {
      doc.addFileToVFS(`${name}.ttf`, base64());
      doc.addFont(`${name}.ttf`, name, "normal");
      added.add(name);
    }
    doc.setFont(name, "normal");
  };
  const setSans = (bold: boolean) => {
    const style = bold ? "bold" : "normal";
    setFace(SANS_FACES[style], () => loadSansFonts()[style]);
  };
  let sansGlyph: ((code: number) => boolean) | undefined;
  let serifGlyph: ((code: number) => boolean) | undefined;
  const hasSansGlyph = (code: number) => {
    if (!sansGlyph) {
      setSans(false);
      sansGlyph = glyphCheck(doc.getFont().metadata);
    }
    return sansGlyph(code);
  };
  const hasSerifGlyph = (code: number) => {
    if (!serifGlyph) {
      setFace(SERIF_FACES.normal.name, () => SERIF_FACES.normal.base64);
      serifGlyph = glyphCheck(doc.getFont().metadata);
    }
    return serifGlyph(code);
  };
  const characters = new Map<string, string>();
  const drawable = (text: string) =>
    Array.from(text, (character) => {
      let kept = characters.get(character);
      if (kept === undefined) {
        kept = drawableCharacter(
          character,
          hasSansGlyph(character.codePointAt(0) ?? 0),
        );
        characters.set(character, kept);
      }
      return kept;
    }).join("");
  const serifCharacters = new Map<string, boolean>();
  const serifFace = (character: string): Face => {
    let kept = serifCharacters.get(character);
    if (kept === undefined) {
      kept =
        !RIGHT_TO_LEFT.test(character) &&
        hasSerifGlyph(character.codePointAt(0) ?? 0);
      serifCharacters.set(character, kept);
    }
    return kept ? "serif" : "sans";
  };
  const proseRuns = (text: string) => {
    const split: Run[] = serif
      ? runsBy(text, serifFace)
      : [{ text, face: "sans" }];
    return split.map((run) =>
      run.face === "sans" ? { text: drawable(run.text), face: run.face } : run,
    );
  };
  const runs = (text: string, font: PdfFont) =>
    font.mono
      ? runsBy(text, courierFace).flatMap((run) =>
          run.face === "courier" ? [run] : proseRuns(run.text),
        )
      : proseRuns(text);
  const selectFont = (font: PdfFont, face: Face) => {
    const style: keyof typeof SERIF_FACES = font.bold
      ? font.italic
        ? "bolditalic"
        : "bold"
      : font.italic
        ? "italic"
        : "normal";
    if (face === "courier") doc.setFont("courier", style);
    else if (face === "sans") setSans(font.bold);
    else setFace(SERIF_FACES[style].name, () => SERIF_FACES[style].base64);
    doc.setFontSize(font.size);
  };
  const characterWidths = new Map<string, number>();
  const measureRuns = (text: string, font: PdfFont) =>
    runs(text, font).reduce((total, run) => {
      if (!run.text) return total;
      selectFont(font, run.face);
      return total + doc.getTextWidth(run.text);
    }, 0);
  const measure = (text: string, font: PdfFont) => {
    if (text.length > 2) return measureRuns(text, font);
    const key = `${font.size}|${Number(font.mono)}${Number(font.bold)}${Number(font.italic)}|${text}`;
    let width = characterWidths.get(key);
    if (width === undefined) {
      width = measureRuns(text, font);
      characterWidths.set(key, width);
    }
    return width;
  };
  let textRuns = 0;
  const canvas: PdfCanvas = {
    width,
    height,
    get page() {
      return doc.getCurrentPageInfo().pageNumber;
    },
    get pageCount() {
      return doc.getNumberOfPages();
    },
    addPage: () => {
      doc.addPage();
    },
    setPage: (page) => {
      doc.setPage(page);
    },
    measure,
    text: (text, x, baseline, font, color) => {
      textRuns += 1;
      if (textRuns > MAX_TEXT_RUNS) throw new PdfTooLongError("text");
      doc.setTextColor(color[0], color[1], color[2]);
      let cursor = x;
      for (const run of runs(text, font)) {
        if (!run.text) continue;
        selectFont(font, run.face);
        if (font.italic && run.face === "sans") {
          doc.text(
            run.text,
            cursor - ITALIC_SKEW * (height - baseline),
            baseline,
            { angle: doc.Matrix(1, 0, ITALIC_SKEW, 1, 0, 0) },
          );
        } else {
          doc.text(run.text, cursor, baseline);
        }
        cursor += doc.getTextWidth(run.text);
      }
    },
    line: (x1, y1, x2, y2, color, lineWidth) => {
      doc.setDrawColor(color[0], color[1], color[2]);
      doc.setLineWidth(lineWidth);
      doc.line(x1, y1, x2, y2);
    },
    fill: (x, y, fillWidth, fillHeight, color) => {
      doc.setFillColor(color[0], color[1], color[2]);
      doc.rect(x, y, fillWidth, fillHeight, "F");
    },
    link: (x, y, linkWidth, linkHeight, url) => {
      doc.link(x, y, linkWidth, linkHeight, { url });
    },
  };
  layoutDocumentPdf(input, canvas);
  return Buffer.from(doc.output("arraybuffer"));
}
