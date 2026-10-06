import { OPS, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api.js";

import type { ParsedElement, ParsedParagraph } from "./pptx-parser.js";

export type Mat = [number, number, number, number, number, number];

const EMU_PER_POINT = 12700;

export interface PdfFidelityPage {
  pageNumber: number;
  widthEmu: number;
  heightEmu: number;
  backgroundColor: string | undefined;
  elements: ParsedElement[];
  imagesSkipped: number;
}

export interface PdfPageImage {
  pageNumber: number;
  images: { data: Uint8Array; name: string }[];
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type PdfOperatorList = Awaited<ReturnType<PDFPageProxy["getOperatorList"]>>;

export function applyPoint(m: Mat, x: number, y: number): [number, number] {
  const p: [number, number] = [x, y];
  Util.applyTransform(p, m);
  return p;
}

function rectFromCorners(corners: [number, number][]): Rect {
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

function rectArea(rect: Rect): number {
  return (
    Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top)
  );
}

function rectOverlapFraction(rect: Rect, other: Rect): number {
  const overlapLeft = Math.max(rect.left, other.left);
  const overlapRight = Math.min(rect.right, other.right);
  const overlapTop = Math.max(rect.top, other.top);
  const overlapBottom = Math.min(rect.bottom, other.bottom);
  const overlapWidth = Math.max(0, overlapRight - overlapLeft);
  const overlapHeight = Math.max(0, overlapBottom - overlapTop);
  const rectOwnArea = rectArea(rect);
  if (rectOwnArea === 0) return 0;
  return (overlapWidth * overlapHeight) / rectOwnArea;
}

export interface TextRunBox extends Rect {
  text: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
  underline: boolean;
  href: string | undefined;
  fontFamily: string | undefined;
  paintOrder: number;
}

export type UnderlineRect = Rect;

export interface LinkRect extends Rect {
  url: string;
}

const MAX_UNDERLINE_THICKNESS = 4;
const MIN_UNDERLINE_LENGTH = 2;
const UNDERLINE_PROXIMITY = 0.6;

const DEFAULT_TEXT_COLOR = "#000000"; // guard:allow-raw-color - fallback when the page's real fill color can't be determined

/**
 * When a run's real fill color can't be recovered (the color timeline
 * didn't line up 1:1 with `getTextContent()`'s items), defaulting to a
 * fixed black is invisible on a dark deck background — this reads black on
 * a light page and white on a dark one instead, using the same background
 * this page already resolved to.
 *
 * `backgroundColor` only ever comes from a page-covering *vector* fill —
 * there's no cheap, reliable way to sample a raster background photo's
 * actual luminance here (decoding it would mean pulling in the same
 * fragile native-canvas path `pdf-parse-setup.ts` deliberately avoids for
 * text extraction). But a full-bleed photo is still almost never "blank
 * white paper", and design decks overwhelmingly lay light text over
 * full-bleed photos — so when a page has no vector background fill AND
 * covers itself edge-to-edge with an image, assume dark rather than
 * defaulting to the invisible black-on-photo case this was written for.
 */
export function contrastingDefaultColor(
  backgroundColor: string | undefined,
  hasFullBleedImage = false,
): string {
  if (backgroundColor === undefined) {
    return hasFullBleedImage ? "#ffffff" : "#000000"; // guard:allow-raw-color - plain-paper vs. full-bleed-photo fallback, not a design-system token
  }
  const r = parseInt(backgroundColor.slice(1, 3), 16) / 255;
  const g = parseInt(backgroundColor.slice(3, 5), 16) / 255;
  const b = parseInt(backgroundColor.slice(5, 7), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 0.5 ? "#ffffff" : "#000000"; // guard:allow-raw-color - contrast fallback, not a design-system token
}

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function fillColorFromOp(fn: number, args: unknown[]): string | undefined {
  if (fn !== OPS.setFillRGBColor && fn !== OPS.setFillColorN) return undefined;
  const [value] = args;
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value)
    ? value.toLowerCase()
    : undefined;
}

const TEXT_SHOWING_OPS = new Set([
  OPS.showText,
  OPS.showSpacedText,
  OPS.nextLineShowText,
  OPS.nextLineSetSpacingShowText,
]);

function isImagePaintOp(fn: number): boolean {
  return fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject;
}

const FILL_PAINT_OPS = new Set([
  OPS.fill,
  OPS.eoFill,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
]);

const STROKE_PAINT_OPS = new Set([
  OPS.stroke,
  OPS.closeStroke,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
]);

const PAINT_OPS = new Set([...FILL_PAINT_OPS, ...STROKE_PAINT_OPS]);

const BACKGROUND_COVERAGE_RATIO = 0.9;

const UNTRACKED_COLOR_OPS = new Set([OPS.setFillColorSpace, OPS.shadingFill]);

const SUBSET_TAG_PATTERN = /^[a-z]{6}\+/i;

function toWebSafeFontFamily(fontName: string): string | undefined {
  const base = fontName.replace(SUBSET_TAG_PATTERN, "").split(/[-,]/)[0].trim();
  if (!base) return undefined;
  const normalized = base.toLowerCase();
  if (/times|georgia|garamond|cambria|palatino|serif/.test(normalized)) {
    return "Georgia";
  }
  if (/courier|mono|consolas/.test(normalized)) {
    return "Courier New";
  }
  return base;
}

export function textItemToBox(
  item: Pick<TextItem, "str" | "transform" | "width"> &
    Partial<Pick<TextItem, "fontName">>,
  viewportTransform: Mat,
  color: string = DEFAULT_TEXT_COLOR,
): TextRunBox | undefined {
  const text = item.str;
  if (!text || !text.trim()) return undefined;
  const t = item.transform as Mat;
  const fontSize = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]) || 1;
  const angle = Math.atan2(t[1], t[0]);
  const dir: [number, number] = [Math.cos(angle), Math.sin(angle)];
  const perp: [number, number] = [-Math.sin(angle), Math.cos(angle)];
  const [baseX, baseY] = [t[4], t[5]];
  const ascent = fontSize * 0.75;
  const descent = fontSize * 0.25;
  const width = item.width || fontSize * text.length * 0.5;
  const localCorners: [number, number][] = [
    [baseX - perp[0] * descent, baseY - perp[1] * descent],
    [
      baseX + dir[0] * width - perp[0] * descent,
      baseY + dir[1] * width - perp[1] * descent,
    ],
    [
      baseX + dir[0] * width + perp[0] * ascent,
      baseY + dir[1] * width + perp[1] * ascent,
    ],
    [baseX + perp[0] * ascent, baseY + perp[1] * ascent],
  ];
  const deviceCorners = localCorners.map(([x, y]) =>
    applyPoint(viewportTransform, x, y),
  );
  const fontName = item.fontName ?? "";
  return {
    ...rectFromCorners(deviceCorners),
    text,
    fontSize,
    bold: /bold/i.test(fontName),
    italic: /italic|oblique/i.test(fontName),
    color,
    underline: false,
    href: undefined,
    fontFamily: toWebSafeFontFamily(fontName),
    paintOrder: 0,
  };
}

export function mergeLine(items: TextRunBox[]): TextRunBox {
  const sorted = [...items].sort((a, b) => a.left - b.left);
  let text = "";
  let prevRight: number | undefined;
  for (const item of sorted) {
    if (
      prevRight !== undefined &&
      item.left - prevRight > item.fontSize * 0.25
    ) {
      text += " ";
    }
    text += item.text;
    prevRight = item.right;
  }
  return {
    ...rectFromCorners(
      sorted.flatMap(
        (s) =>
          [
            [s.left, s.top],
            [s.right, s.bottom],
          ] as [number, number][],
      ),
    ),
    text,
    fontSize: sorted[0].fontSize,
    bold: sorted[0].bold,
    italic: sorted[0].italic,
    color: sorted[0].color,
    underline: sorted.some((s) => s.underline),
    href: sorted.find((s) => s.href)?.href,
    fontFamily: sorted[0].fontFamily,
    paintOrder: Math.min(...sorted.map((s) => s.paintOrder)),
  };
}

export function annotateLineDecorations(
  lines: TextRunBox[],
  underlineRects: UnderlineRect[],
  linkRects: LinkRect[],
): TextRunBox[] {
  return lines.map((line) => {
    const width = Math.max(1, line.right - line.left);
    const underline = underlineRects.some((rect) => {
      const thickness = rect.bottom - rect.top;
      if (thickness < 0 || thickness > MAX_UNDERLINE_THICKNESS) return false;
      const overlapLeft = Math.max(rect.left, line.left);
      const overlapRight = Math.min(rect.right, line.right);
      const horizontalOverlap = Math.max(0, overlapRight - overlapLeft);
      if (horizontalOverlap < width * 0.5) return false;
      const gap = rect.top - line.bottom;
      return (
        gap >= -MAX_UNDERLINE_THICKNESS &&
        gap <= UNDERLINE_PROXIMITY * line.fontSize
      );
    });
    const href = linkRects.find((rect) => {
      const overlapLeft = Math.max(rect.left, line.left);
      const overlapRight = Math.min(rect.right, line.right);
      const overlapTop = Math.max(rect.top, line.top);
      const overlapBottom = Math.min(rect.bottom, line.bottom);
      const overlapWidth = Math.max(0, overlapRight - overlapLeft);
      const overlapHeight = Math.max(0, overlapBottom - overlapTop);
      const overlapArea = overlapWidth * overlapHeight;
      const lineArea = width * Math.max(1, line.bottom - line.top);
      return overlapArea >= lineArea * 0.4;
    })?.url;
    return {
      ...line,
      underline: underline || line.underline,
      href: href ?? line.href,
    };
  });
}

export function groupIntoLines(items: TextRunBox[]): TextRunBox[] {
  return groupByBaseline(items, detectColumnGutter(items)).map(mergeLine);
}

const COLUMN_GUTTER_BUCKET_COUNT = 40;
const MIN_COLUMN_GUTTER_WIDTH_FRACTION = 0.06;
const MIN_ITEMS_PER_COLUMN = 3;

interface ColumnGutter {
  start: number;
  end: number;
}

/**
 * Looks for an x-band that no text item's [left, right] range ever crosses,
 * strictly inside the page's overall text span (not a page margin). A band
 * that wide and that consistently empty across every line on the page — not
 * just one line's word gap, which some other line would fill in — is a real
 * column boundary.
 *
 * ponytail: one global gutter per page, not per text-region — a page with
 * more than two columns, or columns that don't share a single vertical
 * gutter, won't be detected. Upgrade to a real column-layout pass if that
 * shows up in practice.
 */
function detectColumnGutter(items: Rect[]): ColumnGutter | undefined {
  if (items.length < MIN_ITEMS_PER_COLUMN * 2) return undefined;
  const minX = Math.min(...items.map((i) => i.left));
  const maxX = Math.max(...items.map((i) => i.right));
  const span = maxX - minX;
  if (span <= 0) return undefined;
  const bucketWidth = span / COLUMN_GUTTER_BUCKET_COUNT;
  const covered = new Array<boolean>(COLUMN_GUTTER_BUCKET_COUNT).fill(false);
  for (const item of items) {
    const startBucket = Math.max(
      0,
      Math.floor((item.left - minX) / bucketWidth),
    );
    const endBucket = Math.min(
      COLUMN_GUTTER_BUCKET_COUNT - 1,
      Math.floor((item.right - minX) / bucketWidth),
    );
    for (let b = startBucket; b <= endBucket; b++) covered[b] = true;
  }
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  for (let b = 1; b < COLUMN_GUTTER_BUCKET_COUNT - 1; b++) {
    if (covered[b]) {
      runStart = -1;
      continue;
    }
    if (runStart === -1) runStart = b;
    const length = b - runStart + 1;
    if (length > bestLength) {
      bestLength = length;
      bestStart = runStart;
    }
  }
  const minBuckets = Math.ceil(
    COLUMN_GUTTER_BUCKET_COUNT * MIN_COLUMN_GUTTER_WIDTH_FRACTION,
  );
  if (bestStart === -1 || bestLength < minBuckets) return undefined;
  const start = minX + bestStart * bucketWidth;
  const end = minX + (bestStart + bestLength) * bucketWidth;
  const leftCount = items.filter((i) => i.right <= start).length;
  const rightCount = items.filter((i) => i.left >= end).length;
  if (leftCount < MIN_ITEMS_PER_COLUMN || rightCount < MIN_ITEMS_PER_COLUMN) {
    return undefined;
  }
  return { start, end };
}

function columnSideOf(
  item: Rect,
  gutter: ColumnGutter | undefined,
): 0 | 1 | undefined {
  if (!gutter) return undefined;
  if (item.right <= gutter.start) return 0;
  if (item.left >= gutter.end) return 1;
  return undefined;
}

function groupByBaseline(
  items: TextRunBox[],
  columnGutter?: ColumnGutter,
): TextRunBox[][] {
  const lines: TextRunBox[][] = [];
  let current: TextRunBox[] = [];
  for (const item of items) {
    const prev = current[current.length - 1];
    const differentBaseline =
      prev !== undefined &&
      Math.abs(item.top - prev.top) >
        Math.max(item.fontSize, prev.fontSize) * 0.4;
    const differentColumn =
      prev !== undefined &&
      columnSideOf(prev, columnGutter) !== undefined &&
      columnSideOf(item, columnGutter) !== undefined &&
      columnSideOf(prev, columnGutter) !== columnSideOf(item, columnGutter);
    if (prev && (differentBaseline || differentColumn)) {
      lines.push(current);
      current = [item];
    } else {
      current.push(item);
    }
  }
  if (current.length) lines.push(current);
  return lines;
}

export interface TextLine extends Rect {
  fontSize: number;
  runs: TextRunBox[];
}

export function mergeLineRuns(items: TextRunBox[]): TextRunBox[] {
  const sorted = [...items].sort((a, b) => a.left - b.left);
  const runs: TextRunBox[] = [];
  for (const item of sorted) {
    const prev = runs[runs.length - 1];
    const sameStyle =
      prev !== undefined &&
      prev.color === item.color &&
      prev.bold === item.bold &&
      prev.italic === item.italic &&
      prev.underline === item.underline &&
      prev.href === item.href &&
      prev.fontFamily === item.fontFamily;
    const needsSpace =
      prev !== undefined && item.left - prev.right > item.fontSize * 0.25;
    if (prev && sameStyle) {
      prev.text += (needsSpace ? " " : "") + item.text;
      prev.right = Math.max(prev.right, item.right);
      prev.top = Math.min(prev.top, item.top);
      prev.bottom = Math.max(prev.bottom, item.bottom);
      prev.paintOrder = Math.min(prev.paintOrder, item.paintOrder);
    } else {
      const separator =
        needsSpace && !/\s$/.test(prev?.text ?? "") && !/^\s/.test(item.text)
          ? " "
          : "";
      runs.push({ ...item, text: separator + item.text });
    }
  }
  return runs;
}

export function groupIntoStyledLines(items: TextRunBox[]): TextLine[] {
  const columnGutter = detectColumnGutter(items);
  return groupByBaseline(items, columnGutter).map((lineItems) => ({
    ...rectFromCorners(
      lineItems.flatMap(
        (s) =>
          [
            [s.left, s.top],
            [s.right, s.bottom],
          ] as [number, number][],
      ),
    ),
    fontSize: lineItems[0].fontSize,
    runs: mergeLineRuns(lineItems),
  }));
}

export function groupIntoBlocks<T extends Rect & { fontSize: number }>(
  lines: T[],
): T[][] {
  const blocks: T[][] = [];
  let current: T[] = [];
  for (const line of lines) {
    const prev = current[current.length - 1];
    if (prev) {
      const gap = line.top - prev.bottom;
      const sizeRatio = line.fontSize / prev.fontSize;
      const sameBlock =
        gap < prev.fontSize * 0.9 &&
        sizeRatio > 0.7 &&
        sizeRatio < 1.4 &&
        Math.abs(line.left - prev.left) < prev.fontSize * 3;
      if (!sameBlock) {
        blocks.push(current);
        current = [];
      }
    }
    current.push(line);
  }
  if (current.length) blocks.push(current);
  return blocks;
}

export function lineSpacingBeforePt(
  line: Rect,
  previousLine: Rect | undefined,
): number {
  return previousLine ? Math.max(0, line.top - previousLine.bottom) : 0;
}

const TEXT_ALIGNMENT_TOLERANCE_PT = 3;

export function detectBlockAlignment(
  blockLines: Rect[],
  blockLeft: number,
  blockRight: number,
): "left" | "center" | "right" {
  if (blockLines.length < 2) return "left";
  const widths = blockLines.map((line) => line.right - line.left);
  const minWidth = Math.min(...widths);
  const maxWidth = Math.max(...widths);
  const sameBounds = blockLines.every(
    (line) => line.left === blockLeft && line.right === blockRight,
  );
  if (maxWidth - minWidth <= TEXT_ALIGNMENT_TOLERANCE_PT && sameBounds) {
    return "left";
  }
  const midpoint = (blockLeft + blockRight) / 2;
  const centered = blockLines.every(
    (line) =>
      Math.abs((line.left + line.right) / 2 - midpoint) <=
      TEXT_ALIGNMENT_TOLERANCE_PT,
  );
  if (centered) return "center";
  const rightAligned = blockLines.every(
    (line) => Math.abs(line.right - blockRight) <= TEXT_ALIGNMENT_TOLERANCE_PT,
  );
  if (rightAligned) return "right";
  return "left";
}

const BACKGROUND_IMAGE_OVERLAP_RATIO = 0.5;

function resolveRealFontName(
  page: PDFPageProxy,
  fontName: string | undefined,
  cache: Map<string, string>,
): string {
  if (!fontName) return "";
  const cached = cache.get(fontName);
  if (cached !== undefined) return cached;
  let resolved = fontName;
  try {
    if (page.commonObjs.has(fontName)) {
      const font = page.commonObjs.get(fontName) as { name?: string } | null;
      if (font?.name) resolved = font.name;
    }
  } catch {
    // coercion-ok: `commonObjs.get` throwing means the font object isn't
    // resolved yet — `resolved` already defaults to the internal id, so
    // bold detection just won't match for this run instead of failing.
  }
  cache.set(fontName, resolved);
  return resolved;
}

function sliceTextItemBySegments(
  item: TextItem,
  viewportTransform: Mat,
  segments: TextColorRun[],
): { box: TextRunBox; colorKnown: boolean }[] {
  if (segments.length <= 1) {
    const color = segments[0]?.color;
    const box = textItemToBox(item, viewportTransform, color);
    if (!box) return [];
    return [
      {
        box: { ...box, paintOrder: segments[0]?.paintOrder ?? 0 },
        colorKnown: color !== undefined,
      },
    ];
  }
  const fullBox = textItemToBox(item, viewportTransform, DEFAULT_TEXT_COLOR);
  if (!fullBox) return [];
  const totalChars = item.str.length;
  const spanX = fullBox.right - fullBox.left;
  const results: { box: TextRunBox; colorKnown: boolean }[] = [];
  let charOffset = 0;
  for (const segment of segments) {
    const text = item.str.slice(charOffset, charOffset + segment.length);
    if (text.trim().length > 0) {
      const startFraction = charOffset / totalChars;
      const endFraction = (charOffset + segment.length) / totalChars;
      results.push({
        box: {
          ...fullBox,
          left: fullBox.left + spanX * startFraction,
          right: fullBox.left + spanX * endFraction,
          text,
          color: segment.color ?? DEFAULT_TEXT_COLOR,
          paintOrder: segment.paintOrder,
        },
        colorKnown: segment.color !== undefined,
      });
    }
    charOffset += segment.length;
  }
  return results;
}

async function buildTextElements(
  page: PDFPageProxy,
  viewportTransform: Mat,
  pageNumber: number,
  textRuns: TextColorRun[],
  backgroundColor: string | undefined,
  backgroundImageRect: Rect | undefined,
  underlineRects: UnderlineRect[],
  linkRects: LinkRect[],
): Promise<{ element: ParsedElement; paintOrder: number }[]> {
  const content = await page.getTextContent();
  const rawItems = content.items.filter(
    (item): item is TextItem => "str" in item && item.str.trim().length > 0,
  );
  const fontNameCache = new Map<string, string>();

  const segmentQueue = [...textRuns];
  const boxes = rawItems.flatMap((item) => {
    const realFontName = resolveRealFontName(
      page,
      item.fontName,
      fontNameCache,
    );
    const itemForBox = { ...item, fontName: realFontName };
    const itemSegments: TextColorRun[] = [];
    let consumed = 0;
    while (consumed < item.str.length && segmentQueue.length > 0) {
      const segment = segmentQueue[0];
      const remaining = item.str.length - consumed;
      if (segment.length <= remaining) {
        itemSegments.push(segment);
        consumed += segment.length;
        segmentQueue.shift();
      } else {
        itemSegments.push({
          length: remaining,
          color: segment.color,
          paintOrder: segment.paintOrder,
          invisible: segment.invisible,
        });
        segmentQueue[0] = { ...segment, length: segment.length - remaining };
        consumed = item.str.length;
      }
    }
    if (consumed < item.str.length) {
      const lastPaintOrder =
        itemSegments[itemSegments.length - 1]?.paintOrder ?? 0;
      itemSegments.push({
        length: item.str.length - consumed,
        color: undefined,
        paintOrder: lastPaintOrder,
        invisible: itemSegments[itemSegments.length - 1]?.invisible ?? false,
      });
    }
    if (itemSegments.length > 0 && itemSegments.every((s) => s.invisible)) {
      return [];
    }
    return sliceTextItemBySegments(
      itemForBox,
      viewportTransform,
      itemSegments,
    ).map(({ box, colorKnown }) => {
      if (colorKnown) return box;
      const sitsOnBackgroundImage =
        backgroundImageRect !== undefined &&
        rectOverlapFraction(box, backgroundImageRect) >=
          BACKGROUND_IMAGE_OVERLAP_RATIO;
      return {
        ...box,
        color: contrastingDefaultColor(backgroundColor, sitsOnBackgroundImage),
      };
    });
  });
  if (boxes.length === 0) return [];

  const styledLines = groupIntoStyledLines(boxes);
  const flatRuns = styledLines.flatMap((line) => line.runs);
  const decoratedRuns = annotateLineDecorations(
    flatRuns,
    underlineRects,
    linkRects,
  );
  let cursor = 0;
  const lines: TextLine[] = styledLines.map((line) => {
    const runs = decoratedRuns.slice(cursor, cursor + line.runs.length);
    cursor += line.runs.length;
    return { ...line, runs };
  });
  const blocks = groupIntoBlocks(lines);

  return blocks.map((blockLines, index) => {
    const left = Math.min(...blockLines.map((l) => l.left));
    const top = Math.min(...blockLines.map((l) => l.top));
    const right = Math.max(...blockLines.map((l) => l.right));
    const bottom = Math.max(...blockLines.map((l) => l.bottom));
    const alignment = detectBlockAlignment(blockLines, left, right);
    const paragraphs: ParsedParagraph[] = blockLines.map((line, lineIndex) => {
      const spaceBeforePt = lineSpacingBeforePt(
        line,
        blockLines[lineIndex - 1],
      );
      return {
        runs: line.runs.map((run) => ({
          content: run.text,
          fontSize: run.fontSize,
          color: run.color,
          bold: run.bold,
          italic: run.italic,
          underline: run.underline,
          href: run.href,
          fontFamily: run.fontFamily,
        })),
        alignment,
        ...(spaceBeforePt > 0 ? { spaceBeforePt } : {}),
      };
    });
    const paintOrder = Math.min(
      ...blockLines.flatMap((line) => line.runs.map((run) => run.paintOrder)),
    );
    return {
      element: {
        id: `pdf-text-${pageNumber}-${index}`,
        kind: "text",
        x: left * EMU_PER_POINT,
        y: top * EMU_PER_POINT,
        width: Math.max(1, right - left) * EMU_PER_POINT,
        height: Math.max(1, bottom - top) * EMU_PER_POINT,
        paragraphs,
      },
      paintOrder,
    };
  });
}

export interface TextColorRun {
  length: number;
  color: string | undefined;
  paintOrder: number;
  invisible: boolean;
}

export interface PaintedImageRect extends Rect {
  paintOrder: number;
  imageName: string | undefined;
}

interface PageGraphics {
  imageRects: PaintedImageRect[];
  backgroundColor: string | undefined;
  textRuns: TextColorRun[];
  underlineRects: UnderlineRect[];
}

export async function walkPageGraphics(
  page: PDFPageProxy,
  viewport: { transform: Mat; width: number; height: number },
  operatorList?: PdfOperatorList,
): Promise<PageGraphics> {
  const viewportTransform = viewport.transform;
  const opList = operatorList ?? (await page.getOperatorList());
  const imageRects: PaintedImageRect[] = [];
  const textRuns: TextColorRun[] = [];
  const underlineRects: UnderlineRect[] = [];
  let paintOrder = 0;
  let backgroundColor: string | undefined;
  let fillColor = DEFAULT_TEXT_COLOR;
  let fillColorKnown = true;
  let textRenderingMode = 0;
  let ctm: Mat = [1, 0, 0, 1, 0, 0];
  const stack: {
    ctm: Mat;
    fillColor: string;
    fillColorKnown: boolean;
    textRenderingMode: number;
  }[] = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[];
    if (fn === OPS.save) {
      stack.push({ ctm, fillColor, fillColorKnown, textRenderingMode });
    } else if (fn === OPS.restore) {
      const restored = stack.pop();
      if (restored) {
        ctm = restored.ctm;
        fillColor = restored.fillColor;
        fillColorKnown = restored.fillColorKnown;
        textRenderingMode = restored.textRenderingMode;
      }
    } else if (fn === OPS.setTextRenderingMode) {
      const mode = args[0];
      if (typeof mode === "number") textRenderingMode = mode;
    } else if (fn === OPS.transform) {
      ctm = Util.transform(ctm, args as Mat) as Mat;
    } else if (isImagePaintOp(fn)) {
      const unitCorners: [number, number][] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      const deviceCorners = unitCorners.map(([x, y]) => {
        const [ux, uy] = applyPoint(ctm, x, y);
        return applyPoint(viewportTransform, ux, uy);
      });
      imageRects.push({
        ...rectFromCorners(deviceCorners),
        paintOrder: paintOrder++,
        imageName: typeof args[0] === "string" ? args[0] : undefined,
      });
    } else if (TEXT_SHOWING_OPS.has(fn)) {
      const glyphs = args[0];
      const length = Array.isArray(glyphs)
        ? glyphs.filter((g) => typeof g === "object" && g !== null).length
        : 1;
      if (length > 0) {
        textRuns.push({
          length,
          color: fillColorKnown ? fillColor : undefined,
          paintOrder: paintOrder++,
          invisible: textRenderingMode === 3 || textRenderingMode === 7,
        });
      }
    } else if (fn === OPS.constructPath) {
      const paintOp = args[0];
      const bbox = args[2] as number[] | undefined;
      if (
        bbox &&
        bbox.every((v) => Number.isFinite(v)) &&
        PAINT_OPS.has(paintOp as number)
      ) {
        const [minX, minY, maxX, maxY] = bbox;
        const deviceCorners = [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
        ].map(([x, y]) => {
          const [ux, uy] = applyPoint(ctm, x, y);
          return applyPoint(viewportTransform, ux, uy);
        });
        const rect = rectFromCorners(deviceCorners);
        if (
          backgroundColor === undefined &&
          fillColorKnown &&
          FILL_PAINT_OPS.has(paintOp as number)
        ) {
          const coversPage =
            rect.right - rect.left >=
              viewport.width * BACKGROUND_COVERAGE_RATIO &&
            rect.bottom - rect.top >=
              viewport.height * BACKGROUND_COVERAGE_RATIO;
          if (coversPage) backgroundColor = fillColor;
        }
        const width = rect.right - rect.left;
        const height = rect.bottom - rect.top;
        const thickness = Math.min(width, height);
        const length = Math.max(width, height);
        const isLongEnoughForThickness =
          thickness === 0
            ? length >= MIN_UNDERLINE_LENGTH
            : length >= thickness * 3;
        if (thickness <= MAX_UNDERLINE_THICKNESS && isLongEnoughForThickness) {
          underlineRects.push(rect);
        }
      }
    } else if (UNTRACKED_COLOR_OPS.has(fn)) {
      fillColorKnown = false;
    } else if (fn === OPS.setFillRGBColor || fn === OPS.setFillColorN) {
      const color = fillColorFromOp(fn, args);
      fillColor = color ?? fillColor;
      fillColorKnown = color !== undefined;
    }
  }
  return { imageRects, backgroundColor, textRuns, underlineRects };
}

async function collectLinkRects(
  page: PDFPageProxy,
  viewportTransform: Mat,
): Promise<LinkRect[]> {
  const annotations = (await page.getAnnotations({ intent: "display" })) as {
    subtype?: string;
    url?: string;
    rect?: number[];
  }[];
  const rects: LinkRect[] = [];
  for (const annotation of annotations) {
    if (annotation.subtype !== "Link" || !annotation.url) continue;
    const rect = annotation.rect;
    if (!rect || rect.length !== 4 || !rect.every((v) => Number.isFinite(v))) {
      continue;
    }
    const [x1, y1, x2, y2] = rect;
    const deviceCorners = [
      [x1, y1],
      [x2, y1],
      [x2, y2],
      [x1, y2],
    ].map(([x, y]) => applyPoint(viewportTransform, x, y));
    rects.push({ ...rectFromCorners(deviceCorners), url: annotation.url });
  }
  return rects;
}

const MIN_IMAGE_POINTS = 4;

export async function parsePdfFidelity(
  doc: PDFDocumentProxy,
  imagesByPage: PdfPageImage[],
): Promise<PdfFidelityPage[]> {
  const imageBytesByPage = new Map<number, PdfPageImage["images"]>();
  for (const entry of imagesByPage) {
    imageBytesByPage.set(entry.pageNumber, entry.images);
  }

  const pages: PdfFidelityPage[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    let imagePaintCount = 0;
    try {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
      const viewportTransform = viewport.transform as Mat;
      const operatorList = await page.getOperatorList();
      imagePaintCount = operatorList.fnArray.filter(isImagePaintOp).length;

      const graphics = await walkPageGraphics(
        page,
        {
          transform: viewportTransform,
          width: viewport.width,
          height: viewport.height,
        },
        operatorList,
      );
      const linkRects = await collectLinkRects(page, viewportTransform);
      const imageRects = graphics.imageRects;
      const pageArea = viewport.width * viewport.height;
      const backgroundImageRect = imageRects
        .filter((rect) => rectArea(rect) >= pageArea * 0.4)
        .sort((a, b) => rectArea(b) - rectArea(a))[0];
      const imageBytes = imageBytesByPage.get(pageNumber) ?? [];
      const rectsByImageName = new Map<string, PaintedImageRect[]>();
      for (const rect of imageRects) {
        if (rect.imageName === undefined) continue;
        const rects = rectsByImageName.get(rect.imageName) ?? [];
        rects.push(rect);
        rectsByImageName.set(rect.imageName, rects);
      }
      const bytesByImageName = new Map<string, PdfPageImage["images"]>();
      for (const image of imageBytes) {
        const images = bytesByImageName.get(image.name) ?? [];
        images.push(image);
        bytesByImageName.set(image.name, images);
      }
      const imageDataByRect = new Map<PaintedImageRect, Uint8Array>();
      for (const [imageName, rects] of rectsByImageName) {
        const images = bytesByImageName.get(imageName);
        if (!images || images.length !== rects.length) continue;
        for (let index = 0; index < rects.length; index++) {
          const data = images[index].data;
          if (data.byteLength > 0) imageDataByRect.set(rects[index], data);
        }
      }
      const imageResults: { element: ParsedElement; paintOrder: number }[] =
        imageRects
          .map((rect) => ({ rect, data: imageDataByRect.get(rect) }))
          .filter(
            ({ rect, data }) =>
              data &&
              rect.right - rect.left >= MIN_IMAGE_POINTS &&
              rect.bottom - rect.top >= MIN_IMAGE_POINTS,
          )
          .map(({ rect, data }, index) => ({
            element: {
              id: `pdf-img-${pageNumber}-${index}`,
              kind: "image" as const,
              x: rect.left * EMU_PER_POINT,
              y: rect.top * EMU_PER_POINT,
              width: Math.max(1, rect.right - rect.left) * EMU_PER_POINT,
              height: Math.max(1, rect.bottom - rect.top) * EMU_PER_POINT,
              image: {
                data: data as Uint8Array,
                mimeType: "image/png",
                name: `image-${index}`,
              },
            },
            paintOrder: rect.paintOrder,
          }));
      const imagesSkipped = imageRects.filter(
        (rect) => !imageDataByRect.has(rect),
      ).length;

      const textResults = await buildTextElements(
        page,
        viewportTransform,
        pageNumber,
        graphics.textRuns,
        graphics.backgroundColor,
        backgroundImageRect,
        graphics.underlineRects,
        linkRects,
      );

      const elements = [...imageResults, ...textResults]
        .sort((a, b) => a.paintOrder - b.paintOrder)
        .map((result) => result.element);

      pages.push({
        pageNumber,
        widthEmu: viewport.width * EMU_PER_POINT,
        heightEmu: viewport.height * EMU_PER_POINT,
        backgroundColor: graphics.backgroundColor,
        elements,
        imagesSkipped,
      });
    } catch (err) {
      console.warn(
        `[import-file] PDF fidelity parse failed for page ${pageNumber}, falling back for this page:`,
        err instanceof Error ? err.message : String(err),
      );
      pages.push({
        pageNumber,
        widthEmu: 0,
        heightEmu: 0,
        backgroundColor: undefined,
        elements: [],
        imagesSkipped: Math.max(imagePaintCount, 1),
      });
    }
  }
  return pages;
}
