import { OPS, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api.js";

import type { ParsedElement, ParsedParagraph } from "./pptx-parser.js";

/** 2D affine matrix [a, b, c, d, e, f], the same 6-value form PDF content streams use. */
export type Mat = [number, number, number, number, number, number];

const EMU_PER_POINT = 12700; // 914400 EMU/inch / 72 points/inch

/** One page's reconstructed layout, ready to feed into `convertToSlideHtml`. */
export interface PdfFidelityPage {
  pageNumber: number;
  widthEmu: number;
  heightEmu: number;
  /** The page's own painted background, when a full-page fill was found; undefined means "plain paper" (render white). */
  backgroundColor: string | undefined;
  /** Images first (so they paint as backgrounds), then text blocks on top. */
  elements: ParsedElement[];
}

/** An embedded raster image already resolved by `pdf.getImage()`, keyed by its page. */
export interface PdfPageImage {
  pageNumber: number;
  images: { data: Uint8Array }[];
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

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

/** Fraction of `rect`'s own area that falls inside `other` (0 when they don't overlap, 1 when `rect` is fully contained). */
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
}

/** A thin filled/stroked rect from the content stream — the usual way PDFs draw an underline (there's no inline "underline" text attribute). */
export type UnderlineRect = Rect;

/** A "Link" annotation's clickable area plus its target URL, in device coordinates. */
export interface LinkRect extends Rect {
  url: string;
}

/** Max stroke/fill thickness (in device px) still considered a plausible underline rather than a divider or a shape. */
const MAX_UNDERLINE_THICKNESS = 4;
/** A zero-height stroked hairline still needs to span a real distance to count as an underline, not a stray dot or corner join. */
const MIN_UNDERLINE_LENGTH = 2;
/** An underline sits just under a line's baseline; this bounds how far below the text box bottom it can be and still count. */
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

/**
 * Returns the fill color set by this op, or undefined when it isn't
 * decodable. pdf.js's evaluator resolves *every* non-Pattern fill-color
 * operator in the content stream (`g`, `rg`, `k`, and `sc`/`scn` against any
 * non-Pattern colorspace — including ICCBased/CalRGB/Lab/Separation/DeviceN,
 * which professionally-authored PDFs commonly route through `scn`) into an
 * already-computed `"#rrggbb"` string, rewriting the op itself to
 * `OPS.setFillRGBColor` before it ever reaches `getOperatorList()`'s
 * `argsArray` — the original per-component numeric operands the content
 * stream actually contains never show up here. Only `scn` against a genuine
 * Pattern colorspace keeps `OPS.setFillColorN`, with a pattern name (or
 * tiling/shading descriptor) instead of a color string — genuinely
 * undecodable without resolving that pattern object.
 */
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

/** Any op that paints a path (fill or stroke) — an underline can be drawn either way. */
const PAINT_OPS = new Set([...FILL_PAINT_OPS, ...STROKE_PAINT_OPS]);

/** A page-covering fill is almost always the very first thing painted, so keep the earliest match. */
const BACKGROUND_COVERAGE_RATIO = 0.9;

/**
 * Color-affecting ops that always invalidate the tracked fill color: a
 * colorspace change (`cs`) resets the current color to that space's
 * initial value (not necessarily black), and a shading fill (`sh`) paints
 * a gradient with no single color at all. `sc`/`scn` are handled inline in
 * the walk below instead, since whether they're decodable depends on
 * their operands (see `fillColorFromOp`), not just which op it is.
 */
const UNTRACKED_COLOR_OPS = new Set([OPS.setFillColorSpace, OPS.shadingFill]);

/**
 * `getTextContent()` gives baseline position + font size per run but no
 * paragraph structure — PDFs don't have one. Each run's placed box is
 * derived from its own transform (baseline, direction, font size) rather
 * than assumed axis-aligned, so rotated/skewed runs still land in roughly
 * the right place even though the emitted element itself is axis-aligned.
 */
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
  };
}

/** Merge same-line runs left-to-right, inserting a space across word-sized gaps. */
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
  };
}

/**
 * PDFs don't carry an inline "underline" run attribute — an underline is
 * just a thin fill/stroke drawn under the text — and a hyperlink is a
 * separate "Link" annotation with its own clickable rect, not part of the
 * text run at all. Both are recovered geometrically: a line is underlined
 * when a thin rect sits directly beneath it, and linked when its box falls
 * inside a Link annotation's rect.
 */
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

/** Group same-baseline runs into lines, in the order pdf.js emitted them (reading order for typical single-column pages). */
export function groupIntoLines(items: TextRunBox[]): TextRunBox[] {
  return groupByBaseline(items).map(mergeLine);
}

/** Shared by `groupIntoLines` and `groupIntoStyledLines`: cluster items whose baselines are close enough to read as the same physical line. */
function groupByBaseline(items: TextRunBox[]): TextRunBox[][] {
  const lines: TextRunBox[][] = [];
  let current: TextRunBox[] = [];
  for (const item of items) {
    const prev = current[current.length - 1];
    if (
      prev &&
      Math.abs(item.top - prev.top) >
        Math.max(item.fontSize, prev.fontSize) * 0.4
    ) {
      lines.push(current);
      current = [item];
    } else {
      current.push(item);
    }
  }
  if (current.length) lines.push(current);
  return lines;
}

/** A physical line that may mix more than one styled run (e.g. "Nike NYC: " white next to "Event Details" blue) instead of collapsing the whole line to one style. */
export interface TextLine extends Rect {
  fontSize: number;
  runs: TextRunBox[];
}

/**
 * Merge same-line runs left-to-right into styled runs: adjacent items
 * sharing the same color/bold/italic/underline/href collapse into one run
 * (joining across word-sized gaps, same as `mergeLine`), but a style change
 * always starts a new run instead of being silently overwritten by
 * whichever item happens to sort first.
 */
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
      prev.href === item.href;
    if (prev && sameStyle) {
      const needsSpace = item.left - prev.right > item.fontSize * 0.25;
      prev.text += (needsSpace ? " " : "") + item.text;
      prev.right = Math.max(prev.right, item.right);
      prev.top = Math.min(prev.top, item.top);
      prev.bottom = Math.max(prev.bottom, item.bottom);
    } else {
      runs.push({ ...item });
    }
  }
  return runs;
}

/** Like `groupIntoLines`, but keeps each line's distinct-styled runs separate — needed once a line can mix colors/weights within itself. */
export function groupIntoStyledLines(items: TextRunBox[]): TextLine[] {
  return groupByBaseline(items).map((lineItems) => ({
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

/**
 * Group lines into text blocks (paragraph-level elements) so a heading and
 * an unrelated body paragraph don't collapse into one giant text box — a
 * new block starts on a size change, a big left-indent jump, or a vertical
 * gap wider than the previous line's own height. Generic over both a
 * single-style `TextRunBox` line and a multi-run `TextLine`, since both
 * carry the `top`/`bottom`/`left`/`fontSize` this grouping actually reads.
 */
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

/** A run needs to overlap most of a candidate background image to inherit its "assume dark" contrast — a run merely near a small inset photo shouldn't be treated as sitting on top of it. */
const BACKGROUND_IMAGE_OVERLAP_RATIO = 0.5;

/**
 * `getTextContent()`'s internal font id (e.g. `"g_d0_f1"`) is never the
 * PDF's real font name — its own bold detection needs the actual resolved
 * font object's `.name` (e.g. `"MUFUZY+Poppins-Bold"`), which pdf.js has
 * already loaded into `page.commonObjs` by the time text content resolves.
 */
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

/**
 * A single `getTextContent()` item only ever carries one font/position, but
 * a page's content stream can paint it with more than one fill color —
 * pdf.js merges runs purely by geometric continuity (position + font),
 * never by paint color, so "Nike NYC: " (white) immediately followed by
 * "Event Details" (blue) on the same line is reported as one merged item.
 * Slicing that item's own text and placed width proportionally by
 * character count recovers each color as its own run.
 */
function sliceTextItemBySegments(
  item: TextItem,
  viewportTransform: Mat,
  segments: TextColorRun[],
): { box: TextRunBox; colorKnown: boolean }[] {
  if (segments.length <= 1) {
    const color = segments[0]?.color;
    const box = textItemToBox(item, viewportTransform, color);
    return box ? [{ box, colorKnown: color !== undefined }] : [];
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
): Promise<ParsedElement[]> {
  const content = await page.getTextContent();
  const rawItems = content.items.filter(
    (item): item is TextItem => "str" in item && item.str.trim().length > 0,
  );
  const fontNameCache = new Map<string, string>();

  // Walk `textRuns` alongside `rawItems` by character count rather than by
  // index — the two lists don't share a 1:1 item boundary (see
  // `sliceTextItemBySegments`), so each item claims exactly as many
  // characters worth of segments as its own text is long.
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
        // This segment overshoots the item boundary — pdf.js's merge
        // doesn't line up with our op-derived segment counts (e.g. a
        // ligature collapsing multiple glyphs into fewer output
        // characters). Split what fits and leave the remainder queued for
        // the next item instead of corrupting this item's text.
        itemSegments.push({ length: remaining, color: segment.color });
        segmentQueue[0] = { ...segment, length: segment.length - remaining };
        consumed = item.str.length;
      }
    }
    if (consumed < item.str.length) {
      itemSegments.push({
        length: item.str.length - consumed,
        color: undefined,
      });
    }
    return sliceTextItemBySegments(
      itemForBox,
      viewportTransform,
      itemSegments,
    ).map(({ box, colorKnown }) => {
      if (colorKnown) return box;
      // No recovered color for this run — rather than guessing "blank
      // white paper" for the whole page, check what's actually behind
      // THIS run: a title over a background photo needs a different
      // default than body text below it on plain canvas, same page.
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
    const paragraphs: ParsedParagraph[] = blockLines.map((line) => ({
      runs: line.runs.map((run) => ({
        content: run.text,
        fontSize: run.fontSize,
        color: run.color,
        bold: run.bold,
        italic: run.italic,
        underline: run.underline,
        href: run.href,
      })),
      alignment: "left",
    }));
    return {
      id: `pdf-text-${pageNumber}-${index}`,
      kind: "text",
      x: left * EMU_PER_POINT,
      y: top * EMU_PER_POINT,
      width: Math.max(1, right - left) * EMU_PER_POINT,
      height: Math.max(1, bottom - top) * EMU_PER_POINT,
      paragraphs,
    };
  });
}

/** The fill color active during one real (non-empty) text-showing op, plus how many characters it covers — `getTextContent()` can merge several differently-colored ops into a single item (it only splits on position/font continuity, never on paint color), so recovering per-color runs within one item means walking this list by character count rather than by item. */
export interface TextColorRun {
  length: number;
  color: string | undefined;
}

interface PageGraphics {
  imageRects: Rect[];
  /** The earliest fill covering most of the page — almost always the deck's background. */
  backgroundColor: string | undefined;
  /** Fill color + character length of each real text-showing op, in operator-list order; `color` is undefined when it wasn't recoverable. */
  textRuns: TextColorRun[];
  /** Thin filled/stroked rects found anywhere on the page — underline candidates, matched against text lines afterward. */
  underlineRects: UnderlineRect[];
}

/**
 * Images are painted into a unit square [0,1]x[0,1] transformed by the CTM
 * at the time of the paint op — there is no separate "image extent"
 * operator, so real placement requires walking the operator list and
 * tracking the transform stack through save/restore/transform, exactly
 * like `pdf-parse`'s own internal path-geometry walk does for shapes. The
 * same walk also tracks the current fill color (from `rg`/`g`/`k` ops) so a
 * full-page background fill and each text run's real color can be read off
 * as we pass over them — `getTextContent()` alone carries neither.
 */
export async function walkPageGraphics(
  page: PDFPageProxy,
  viewport: { transform: Mat; width: number; height: number },
): Promise<PageGraphics> {
  const viewportTransform = viewport.transform;
  const opList = await page.getOperatorList();
  const imageRects: Rect[] = [];
  const textRuns: TextColorRun[] = [];
  const underlineRects: UnderlineRect[] = [];
  let backgroundColor: string | undefined;
  let fillColor = DEFAULT_TEXT_COLOR;
  // False whenever the color was set through an operator this walk doesn't
  // decode (a pattern/separation/ICC colorspace fill via `scn`/`SCN`, common
  // for exact brand colors) — `fillColor` is then a stale guess, not a real
  // reading, and must not be trusted for text or background detection.
  let fillColorKnown = false;
  let ctm: Mat = [1, 0, 0, 1, 0, 0];
  const stack: { ctm: Mat; fillColor: string; fillColorKnown: boolean }[] = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[];
    if (fn === OPS.save) {
      stack.push({ ctm, fillColor, fillColorKnown });
    } else if (fn === OPS.restore) {
      const restored = stack.pop();
      if (restored) {
        ctm = restored.ctm;
        fillColor = restored.fillColor;
        fillColorKnown = restored.fillColorKnown;
      }
    } else if (fn === OPS.transform) {
      ctm = Util.transform(ctm, args as Mat) as Mat;
    } else if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintInlineImageXObject
    ) {
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
      imageRects.push(rectFromCorners(deviceCorners));
    } else if (TEXT_SHOWING_OPS.has(fn)) {
      // Count only the glyph descriptors, not the raw kerning-adjustment
      // numbers a `TJ` array can interleave between them, so this length
      // matches the character count `getTextContent()` will report for the
      // text these glyphs decode to.
      const glyphs = args[0];
      const length = Array.isArray(glyphs)
        ? glyphs.filter((g) => typeof g === "object" && g !== null).length
        : 1;
      // A zero-glyph showText (a leftover empty run from a style-boundary
      // split in the source PDF) never produces any characters in
      // `getTextContent()` — skip it instead of pushing a zero-length
      // segment that would just sit there contributing nothing.
      if (length > 0) {
        textRuns.push({
          length,
          color: fillColorKnown ? fillColor : undefined,
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
        // A pure stroke ("S"/"s", no fill) draws a hairline whose path bbox
        // has zero thickness — the line width isn't baked into this bbox at
        // all — so `thickness === 0` is the *normal* shape for a stroked
        // underline, not a degenerate case to reject.
        const isLongEnoughForThickness =
          thickness === 0
            ? length >= MIN_UNDERLINE_LENGTH
            : length >= thickness * 3;
        if (thickness <= MAX_UNDERLINE_THICKNESS && isLongEnoughForThickness) {
          underlineRects.push(rect);
        }
      }
    } else if (UNTRACKED_COLOR_OPS.has(fn)) {
      // A colorspace change or a gradient shading fill is never decoded,
      // so the previously tracked fillColor can no longer be trusted
      // until a recognized color-setting op sets it again.
      fillColorKnown = false;
    } else if (fn === OPS.setFillRGBColor || fn === OPS.setFillColorN) {
      // A resolved hex string decodes via fillColorFromOp; a Pattern
      // operand (a name, not a color string) doesn't, and must invalidate
      // the previous color rather than silently keep it.
      const color = fillColorFromOp(fn, args);
      fillColor = color ?? fillColor;
      fillColorKnown = color !== undefined;
    }
  }
  return { imageRects, backgroundColor, textRuns, underlineRects };
}

/**
 * Hyperlinks live outside the content stream entirely, as page-level "Link"
 * annotations with their own clickable rect and target URL — there's no
 * operator-list event for them at all.
 */
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

/**
 * Reconstruct each page's real layout — positioned text blocks at their
 * actual sizes plus every embedded image at its actual placement — instead
 * of flattening the page to one guessed background photo and a canned text
 * template. Falls back to an empty element list for a page that fails to
 * parse; the caller decides how to degrade (e.g. plain extracted text).
 */
export async function parsePdfFidelity(
  doc: PDFDocumentProxy,
  imagesByPage: PdfPageImage[],
): Promise<PdfFidelityPage[]> {
  const imageBytesByPage = new Map<number, Uint8Array[]>();
  for (const entry of imagesByPage) {
    imageBytesByPage.set(
      entry.pageNumber,
      entry.images.map((img) => img.data),
    );
  }

  const pages: PdfFidelityPage[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    try {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
      const viewportTransform = viewport.transform as Mat;

      const graphics = await walkPageGraphics(page, {
        transform: viewportTransform,
        width: viewport.width,
        height: viewport.height,
      });
      const linkRects = await collectLinkRects(page, viewportTransform);
      const imageRects = graphics.imageRects;
      // The largest image that covers a substantial share of the page is
      // this page's background candidate for contrast purposes — it need
      // not reach every edge (a design's photo can have a slight margin
      // or be one of several stacked decorative layers) to still be what
      // text is actually sitting on top of.
      const pageArea = viewport.width * viewport.height;
      const backgroundImageRect = imageRects
        .filter((rect) => rectArea(rect) >= pageArea * 0.4)
        .sort((a, b) => rectArea(b) - rectArea(a))[0];
      const imageBytes = imageBytesByPage.get(pageNumber) ?? [];
      const imageElements: ParsedElement[] = imageRects
        .map((rect, index) => ({ rect, data: imageBytes[index] }))
        .filter(
          ({ rect, data }) =>
            data &&
            rect.right - rect.left >= MIN_IMAGE_POINTS &&
            rect.bottom - rect.top >= MIN_IMAGE_POINTS,
        )
        .map(({ rect, data }, index) => ({
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
        }));

      const textElements = await buildTextElements(
        page,
        viewportTransform,
        pageNumber,
        graphics.textRuns,
        graphics.backgroundColor,
        backgroundImageRect,
        graphics.underlineRects,
        linkRects,
      );

      pages.push({
        pageNumber,
        widthEmu: viewport.width * EMU_PER_POINT,
        heightEmu: viewport.height * EMU_PER_POINT,
        backgroundColor: graphics.backgroundColor,
        elements: [...imageElements, ...textElements],
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
      });
    }
  }
  return pages;
}
