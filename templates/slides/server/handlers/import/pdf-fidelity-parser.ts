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
  /** Sorted by the PDF's own real paint order, so an image painted over text (or vice versa) keeps its real stacking instead of images always sitting behind. */
  elements: ParsedElement[];
  /** Images detected on this page whose pixel data never made it into `elements` (extraction failed, or no canvas renderer was available) — a non-zero count means this page's fidelity is not source-faithful. */
  imagesSkipped: number;
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
  fontFamily: string | undefined;
  /** Index in this page's real content-stream paint order, shared with image paint events — lets the final element list be z-ordered by how the PDF actually painted it instead of images-always-first. */
  paintOrder: number;
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

/** A PDF-embedded subset font name is prefixed with a 6-letter tag plus "+" (e.g. "MUFUZY+Poppins-Bold") — that tag and the PostScript style suffix after it are never real CSS font-family values. */
const SUBSET_TAG_PATTERN = /^[a-z]{6}\+/i;

/**
 * Maps a PDF's real (subset-tag-stripped) font name onto the nearest
 * websafe CSS family by a simple keyword match, since the raw PostScript
 * name (e.g. "TimesNewRomanPSMT") usually isn't installed or resolvable as
 * a browser font-family at all. Returns undefined for an unresolved font id
 * so the caller falls back to the deck's default font instead of rendering
 * a literal empty family.
 */
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
    fontFamily: toWebSafeFontFamily(fontName),
    // Real paint order is only known once this box is sliced from its
    // originating content-stream op in `sliceTextItemBySegments` — callers
    // overwrite this with the real value; 0 is just a type-satisfying default.
    paintOrder: 0,
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
    fontFamily: sorted[0].fontFamily,
    paintOrder: Math.min(...sorted.map((s) => s.paintOrder)),
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
  return groupByBaseline(items, detectColumnGutter(items)).map(mergeLine);
}

/** Buckets scanned across a page's text-item x-span when looking for a recurring empty column gutter. */
const COLUMN_GUTTER_BUCKET_COUNT = 40;
/** A candidate gutter must span at least this fraction of the page's text width — an ordinary word/paragraph gap never gets close. */
const MIN_COLUMN_GUTTER_WIDTH_FRACTION = 0.06;
/** Each side of a candidate gutter needs at least this many items, or it's a stray gap rather than a second column. */
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
  // Buckets 0 and the last one are page margins, not a gutter between columns.
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

/** Which side of a detected column gutter an item falls on; undefined when there's no gutter or the item straddles it. */
function columnSideOf(
  item: Rect,
  gutter: ColumnGutter | undefined,
): 0 | 1 | undefined {
  if (!gutter) return undefined;
  if (item.right <= gutter.start) return 0;
  if (item.left >= gutter.end) return 1;
  return undefined;
}

/** Shared by `groupIntoLines` and `groupIntoStyledLines`: cluster items whose baselines are close enough to read as the same physical line, but never across a detected column gutter even when two columns' baselines coincide. */
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
      // A word-sized gap has to survive a style change too. Only the
      // same-style branch used to re-add it, so a heading whose colour
      // changed mid-line ("7 Air " + "purifying") lost the space at the
      // boundary and rendered as one jammed-together word.
      const separator =
        needsSpace && !/\s$/.test(prev?.text ?? "") && !/^\s/.test(item.text)
          ? " "
          : "";
      runs.push({ ...item, text: separator + item.text });
    }
  }
  return runs;
}

/** Like `groupIntoLines`, but keeps each line's distinct-styled runs separate — needed once a line can mix colors/weights within itself. */
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

/**
 * A line's own `top`/`bottom` still carry its real position from the PDF at
 * this point in the pipeline — the source's actual line spacing (which can
 * be looser than a flat CSS line-height) shows up as the gap between this
 * line's top and the previous line's bottom. Returns 0 for a block's first
 * line (its position is already the block's own placement, not extra
 * spacing) or when there's no real gap to preserve.
 */
export function lineSpacingBeforePt(
  line: Rect,
  previousLine: Rect | undefined,
): number {
  return previousLine ? Math.max(0, line.top - previousLine.bottom) : 0;
}

/** How close a line's own midpoint/edge has to sit to the block's for the whole block to read as centered/right-aligned rather than left. */
const TEXT_ALIGNMENT_TOLERANCE_PT = 3;

/**
 * A block's lines already carry their exact `left`/`right` geometry — rather
 * than always rendering as left-aligned, compare each line against the
 * block's own bounding box to recover which alignment actually produced
 * that geometry. A single line can't disambiguate center from left (every
 * line trivially "centers" on itself), so it's left as-is.
 */
export function detectBlockAlignment(
  blockLines: Rect[],
  blockLeft: number,
  blockRight: number,
): "left" | "center" | "right" {
  if (blockLines.length < 2) return "left";
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
        itemSegments.push({
          length: remaining,
          color: segment.color,
          paintOrder: segment.paintOrder,
        });
        segmentQueue[0] = { ...segment, length: segment.length - remaining };
        consumed = item.str.length;
      }
    }
    if (consumed < item.str.length) {
      // Ran out of tracked color/paint-order segments before this item's
      // text did — reuse the last known paint order (falling back to the
      // very start of the page) rather than leaving it unset.
      const lastPaintOrder =
        itemSegments[itemSegments.length - 1]?.paintOrder ?? 0;
      itemSegments.push({
        length: item.str.length - consumed,
        color: undefined,
        paintOrder: lastPaintOrder,
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

/** The fill color active during one real (non-empty) text-showing op, plus how many characters it covers — `getTextContent()` can merge several differently-colored ops into a single item (it only splits on position/font continuity, never on paint color), so recovering per-color runs within one item means walking this list by character count rather than by item. */
export interface TextColorRun {
  length: number;
  color: string | undefined;
  /** Index in this page's real content-stream paint order, shared with image paint events. */
  paintOrder: number;
}

/** An image's placed rect plus its index in this page's real paint order, shared with `TextColorRun.paintOrder` so images and text can be z-ordered by how the PDF actually painted them instead of images always going first. */
export interface PaintedImageRect extends Rect {
  paintOrder: number;
}

interface PageGraphics {
  imageRects: PaintedImageRect[];
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
  const imageRects: PaintedImageRect[] = [];
  const textRuns: TextColorRun[] = [];
  const underlineRects: UnderlineRect[] = [];
  // Shared by images and text so both can be sorted back into one real
  // paint order afterward, instead of images always sitting behind text.
  let paintOrder = 0;
  let backgroundColor: string | undefined;
  let fillColor = DEFAULT_TEXT_COLOR;
  // Starts true: the PDF spec's initial nonstroking color IS black, so text
  // painted before any explicit color-setting operator is legitimately
  // black, not "unknown." This flips to false whenever the color is set
  // through an operator this walk doesn't decode (a pattern/separation/ICC
  // colorspace fill via `scn`/`SCN`, common for exact brand colors) —
  // `fillColor` is then a stale guess, not a real reading, and must not be
  // trusted for text or background detection.
  let fillColorKnown = true;
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
      imageRects.push({
        ...rectFromCorners(deviceCorners),
        paintOrder: paintOrder++,
      });
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
          paintOrder: paintOrder++,
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
      const imageResults: { element: ParsedElement; paintOrder: number }[] =
        imageRects
          .map((rect, index) => ({ rect, data: imageBytes[index] }))
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
        imagesSkipped: imageRects.length - imageResults.length,
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
        // A failed page parse is a fidelity loss even when no individual
        // image extraction failed. Keep the source-import metadata partial so
        // callers do not report this page as source-faithful.
        imagesSkipped: 1,
      });
    }
  }
  return pages;
}
