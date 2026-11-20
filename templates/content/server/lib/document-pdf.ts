import { readFileSync } from "node:fs";
import path from "node:path";

import { resolveOgFontFiles } from "@agent-native/core/server";
import { jsPDF } from "jspdf";

import { markdownWithTitle } from "../../shared/document-export.js";
import { nfmToDoc, type PMMark, type PMNode } from "../../shared/nfm.js";

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

const MARGIN = 54;
const BODY_SIZE = 11;
const LINE_HEIGHT = 1.5;
const BLOCK_GAP = 4;
const INDENT = 18;
const CODE_SIZE = 9.5;
const TABLE_SIZE = 9.5;
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

function lastOf<T>(items: readonly T[]): T | undefined {
  return items.length ? items[items.length - 1] : undefined;
}

function namedColor(value: unknown): Rgb | null {
  if (typeof value !== "string") return null;
  return NAMED_COLORS.get(value.replace(/_bg$/, "")) ?? null;
}

function linkUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function atomAttrs(node: PMNode): Record<string, unknown> {
  const raw: unknown = node.attrs?.attrsJson;
  if (typeof raw !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
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

  constructor(private readonly canvas: PdfCanvas) {}

  private get bottom() {
    return this.canvas.height - MARGIN;
  }

  private room(height: number) {
    if (this.y + height > this.bottom && this.y > MARGIN) {
      this.canvas.addPage();
      this.y = MARGIN;
    }
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
    let wrapped = false;
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
        wrapped = false;
        continue;
      }
      const font = fontFor(inline.style, size, bold);
      for (const token of inline.text.replace(/\t/g, "    ").split(/(\s+)/)) {
        if (!token) continue;
        if (!token.trim()) {
          if (!(wrapped && !pieces.length)) add(token, inline.style, font);
          continue;
        }
        const tokenWidth = this.canvas.measure(token, font);
        if (
          lineWidth + tokenWidth > width &&
          pieces.some((piece) => !piece.space)
        ) {
          finish();
          wrapped = true;
        }
        if (tokenWidth <= width) {
          add(token, inline.style, font);
          wrapped = false;
          continue;
        }
        let chunk = "";
        for (const character of token) {
          const next = chunk + character;
          if (chunk && lineWidth + this.canvas.measure(next, font) > width) {
            add(chunk, inline.style, font);
            finish();
            wrapped = true;
            chunk = character;
          } else {
            chunk = next;
          }
        }
        if (chunk) add(chunk, inline.style, font);
        wrapped = false;
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
      keepWithNext?: boolean;
    },
    onFirstLine?: FirstLine,
  ) {
    const size = options.size ?? BODY_SIZE;
    const lineHeight = size * LINE_HEIGHT;
    const lines = this.breakLines(
      inlines,
      box.width,
      size,
      Boolean(options.bold),
    );
    if (options.keepWithNext && lines.length <= 3) {
      this.room(lines.length * lineHeight + BODY_SIZE * LINE_HEIGHT * 2);
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

  private withBar(box: Box, color: Rgb, render: (inner: Box) => void) {
    this.room(BODY_SIZE * LINE_HEIGHT);
    const startPage = this.canvas.page;
    const startY = this.y;
    render({ ...box, x: box.x + 14, width: box.width - 14 });
    const endPage = this.canvas.page;
    const endY = this.y;
    for (let page = startPage; page <= endPage; page++) {
      this.canvas.setPage(page);
      const top = page === startPage ? startY : MARGIN;
      const bottom = page === endPage ? endY : this.bottom;
      if (bottom > top) {
        this.canvas.line(box.x + 1.5, top, box.x + 1.5, bottom, color, 2.5);
      }
    }
    this.canvas.setPage(endPage);
  }

  private codeBlock(source: string, box: Box) {
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
      for (const character of sourceLine) {
        if (row && this.canvas.measure(row + character, font) > width) {
          rows.push(row);
          row = character;
        } else {
          row += character;
        }
      }
      rows.push(row);
    }
    this.room(lineHeight + padding * 2);
    this.canvas.fill(box.x, this.y, box.width, padding, CODE_FILL);
    this.y += padding;
    for (const row of rows) {
      this.room(lineHeight);
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

  private list(node: PMNode, box: Box) {
    const start = Number(node.attrs?.start);
    let number = Number.isInteger(start) ? start : 1;
    const inner: Box = {
      ...box,
      x: box.x + INDENT,
      width: box.width - INDENT,
      depth: box.depth + 1,
    };
    (node.content ?? []).forEach((item, index) => {
      if (index > 0) this.gap(2);
      const marker =
        node.type === "orderedList"
          ? `${number++}.`
          : node.type === "bulletList"
            ? BULLETS.charAt(box.depth % BULLETS.length)
            : "";
      const checked =
        node.type === "taskList" ? Boolean(item.attrs?.checked) : null;
      this.blocks(item.content ?? [], inner, (top, lineHeight) => {
        if (checked !== null) {
          this.checkbox(box.x + 3, top + (lineHeight - 8) / 2, checked);
          return;
        }
        const font: PdfFont = {
          mono: false,
          bold: false,
          italic: false,
          size: BODY_SIZE,
        };
        const width = this.canvas.measure(marker, font);
        this.canvas.text(
          marker,
          box.x + INDENT - 6 - width,
          top + (lineHeight - BODY_SIZE) / 2 + BODY_SIZE * 0.8,
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

  private table(node: PMNode, box: Box) {
    const rows = node.content ?? [];
    const columns = Math.max(0, ...rows.map((row) => row.content?.length ?? 0));
    if (!columns) return;
    const columnWidth = box.width / columns;
    const lineHeight = TABLE_SIZE * 1.4;
    const padding = 4;
    rows.forEach((row, rowIndex) => {
      const cells = row.content ?? [];
      const cellLines = Array.from({ length: columns }, (_, column) => {
        const cell: PMNode | undefined = cells[column];
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
      const lineCount = Math.max(1, ...cellLines.map((lines) => lines.length));
      this.room(lineHeight + padding * 2);
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
        if (this.y + lineHeight > this.bottom) {
          borders(this.y);
          this.canvas.addPage();
          this.y = MARGIN;
          segmentTop = this.y;
        }
        cellLines.forEach((lines, column) => {
          const line: Line | undefined = lines[index];
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

  private block(node: PMNode, box: Box, onFirstLine?: FirstLine) {
    const indent = Number(node.attrs?.indent);
    const shifted =
      Number.isInteger(indent) && indent > 0
        ? {
            ...box,
            x: box.x + indent * INDENT,
            width: box.width - indent * INDENT,
          }
        : box;
    if (node.type === "paragraph") {
      this.paragraph(inlinesOf(node.content, PLAIN), shifted, {}, onFirstLine);
      return;
    }
    if (node.type === "heading") {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
      const size = HEADING_SIZES.get(level) ?? BODY_SIZE;
      this.gap(size * 0.6);
      this.paragraph(
        inlinesOf(node.content, PLAIN),
        shifted,
        { size, bold: true, keepWithNext: true },
        onFirstLine,
      );
      this.y += 2;
      return;
    }
    this.room(BODY_SIZE * LINE_HEIGHT);
    onFirstLine?.(this.y, BODY_SIZE * LINE_HEIGHT);
    if (
      node.type === "bulletList" ||
      node.type === "orderedList" ||
      node.type === "taskList"
    ) {
      this.list(node, shifted);
    } else if (node.type === "blockquote") {
      this.withBar(shifted, RULE, (inner) =>
        this.blocks(node.content ?? [], { ...inner, color: QUOTE }),
      );
    } else if (node.type === "notionCallout") {
      this.withBar(shifted, namedColor(node.attrs?.color) ?? RULE, (inner) =>
        this.blocks(node.content ?? [], inner),
      );
    } else if (node.type === "codeBlock") {
      this.codeBlock(
        (node.content ?? []).map((child) => child.text ?? "").join(""),
        shifted,
      );
    } else if (
      node.type === "notionBlockAtom" &&
      node.attrs?.tagName === "equation"
    ) {
      this.codeBlock(atomText(node), shifted);
    } else if (node.type === "horizontalRule") {
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
      this.table(node, shifted);
    } else if (node.type === "notionToggle") {
      const summary = node.content?.[0];
      const children = node.content?.slice(1) ?? [];
      if (summary) {
        this.paragraph(inlinesOf(summary.content, PLAIN), shifted, {});
      }
      this.blocks(children, {
        ...shifted,
        x: shifted.x + INDENT,
        width: shifted.width - INDENT,
      });
    } else if (node.type === "localMdxComponent") {
      const children: unknown = node.attrs?.children;
      if (typeof children === "string" && children.trim()) {
        this.blocks(nfmToDoc(children).content, shifted);
      }
    } else if (node.content?.length) {
      this.blocks(node.content, shifted);
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
        );
      }
    }
  }

  blocks(nodes: readonly PMNode[], box: Box, onFirstLine?: FirstLine) {
    nodes.forEach((node, index) => {
      if (index > 0) this.gap(BLOCK_GAP);
      this.block(node, box, index === 0 ? onFirstLine : undefined);
    });
    if (!nodes.length) {
      this.room(BODY_SIZE * LINE_HEIGHT);
      onFirstLine?.(this.y, BODY_SIZE * LINE_HEIGHT);
      this.y += BODY_SIZE * LINE_HEIGHT;
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
  input: { title: string; content: string | null | undefined },
  canvas: PdfCanvas,
) {
  const doc = nfmToDoc(markdownWithTitle(input.title, input.content));
  const layout = new PdfLayout(canvas);
  layout.blocks(doc.content, {
    x: MARGIN,
    width: canvas.width - MARGIN * 2,
    color: TEXT,
    depth: 0,
  });
  layout.pageNumbers();
}

const SANS = "LiberationSans";
const SANS_FILES = {
  normal: "LiberationSans-Regular.ttf",
  bold: "LiberationSans-Bold.ttf",
} as const;
const UNDRAWABLE =
  /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\p{Variation_Selector}\p{Join_Control}]/gu;

let sansFonts: Record<keyof typeof SANS_FILES, string> | undefined;

function loadSansFonts() {
  if (sansFonts) return sansFonts;
  const files = resolveOgFontFiles() ?? [];
  const read = (name: string) => {
    const file = files.find((candidate) => path.basename(candidate) === name);
    if (!file) throw new Error(`The PDF font ${name} is unavailable.`);
    return readFileSync(file).toString("base64");
  };
  sansFonts = { normal: read(SANS_FILES.normal), bold: read(SANS_FILES.bold) };
  return sansFonts;
}

function drawable(text: string) {
  return text.replace(UNDRAWABLE, (character) =>
    (character.codePointAt(0) ?? 0) < 0x2190 &&
    !/\p{Variation_Selector}|\p{Join_Control}/u.test(character)
      ? character
      : "",
  );
}

function monoSegments(text: string) {
  const segments: Array<{ text: string; mono: boolean }> = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const mono =
      (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff);
    const last = lastOf(segments);
    if (last && last.mono === mono) last.text += character;
    else segments.push({ text: character, mono });
  }
  return segments.map((segment) =>
    segment.mono ? segment : { ...segment, text: drawable(segment.text) },
  );
}

export function renderDocumentPdf(input: {
  title: string;
  content: string | null | undefined;
}): Buffer {
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const fonts = loadSansFonts();
  doc.addFileToVFS(SANS_FILES.normal, fonts.normal);
  doc.addFileToVFS(SANS_FILES.bold, fonts.bold);
  doc.addFont(SANS_FILES.normal, SANS, "normal");
  doc.addFont(SANS_FILES.bold, SANS, "bold");
  doc.setProperties({ title: input.title, creator: "Agent-Native Content" });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const segments = (text: string, font: PdfFont) =>
    font.mono ? monoSegments(text) : [{ text: drawable(text), mono: false }];
  const selectFont = (font: PdfFont, mono: boolean) => {
    const style = mono
      ? `${font.bold ? "bold" : ""}${font.italic ? "italic" : ""}` || "normal"
      : font.bold
        ? "bold"
        : "normal";
    doc.setFont(mono ? "courier" : SANS, style);
    doc.setFontSize(font.size);
  };
  const measure = (text: string, font: PdfFont) =>
    segments(text, font).reduce((total, segment) => {
      selectFont(font, segment.mono);
      return total + doc.getTextWidth(segment.text);
    }, 0);
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
      doc.setTextColor(color[0], color[1], color[2]);
      let cursor = x;
      for (const segment of segments(text, font)) {
        if (!segment.text) continue;
        selectFont(font, segment.mono);
        if (font.italic && !segment.mono) {
          doc.text(
            segment.text,
            cursor - ITALIC_SKEW * (height - baseline),
            baseline,
            { angle: doc.Matrix(1, 0, ITALIC_SKEW, 1, 0, 0) },
          );
        } else {
          doc.text(segment.text, cursor, baseline);
        }
        cursor += doc.getTextWidth(segment.text);
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
