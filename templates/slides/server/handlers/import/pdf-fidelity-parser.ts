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

export interface TextRunBox extends Rect {
  text: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
}

const DEFAULT_TEXT_COLOR = "#000000"; // guard:allow-raw-color - fallback when the page's real fill color can't be determined

/** `rg`/`g`/`k` operator args (0..1 components) converted to a `#rrggbb` string. */
function rgbToHex(r: number, g: number, b: number): string {
  const toByte = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

function cmykToHex(c: number, m: number, y: number, k: number): string {
  return rgbToHex((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
}

/**
 * When a run's real fill color can't be recovered (the color timeline
 * didn't line up 1:1 with `getTextContent()`'s items), defaulting to a
 * fixed black is invisible on a dark deck background — this reads black on
 * a light page and white on a dark one instead, using the same background
 * this page already resolved to.
 */
export function contrastingDefaultColor(
  backgroundColor: string | undefined,
): string {
  const hex = backgroundColor ?? "#ffffff"; // guard:allow-raw-color - plain-paper fallback, not a design-system token
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 0.5 ? "#ffffff" : "#000000"; // guard:allow-raw-color - contrast fallback, not a design-system token
}

/** Returns the fill color set by this op, or undefined when it isn't a (simple RGB/gray/CMYK) fill-color op. */
function fillColorFromOp(fn: number, args: unknown[]): string | undefined {
  if (fn === OPS.setFillRGBColor) {
    const [r, g, b] = args as number[];
    return rgbToHex(r, g, b);
  }
  if (fn === OPS.setFillGray) {
    const [gray] = args as number[];
    return rgbToHex(gray, gray, gray);
  }
  if (fn === OPS.setFillCMYKColor) {
    const [c, m, y, k] = args as number[];
    return cmykToHex(c, m, y, k);
  }
  return undefined;
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

/** A page-covering fill is almost always the very first thing painted, so keep the earliest match. */
const BACKGROUND_COVERAGE_RATIO = 0.9;

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
  };
}

/** Group same-baseline runs into lines, in the order pdf.js emitted them (reading order for typical single-column pages). */
export function groupIntoLines(items: TextRunBox[]): TextRunBox[] {
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
  return lines.map(mergeLine);
}

/**
 * Group lines into text blocks (paragraph-level elements) so a heading and
 * an unrelated body paragraph don't collapse into one giant text box — a
 * new block starts on a size change, a big left-indent jump, or a vertical
 * gap wider than the previous line's own height.
 */
export function groupIntoBlocks(lines: TextRunBox[]): TextRunBox[][] {
  const blocks: TextRunBox[][] = [];
  let current: TextRunBox[] = [];
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

async function buildTextElements(
  page: PDFPageProxy,
  viewportTransform: Mat,
  pageNumber: number,
  textColors: string[],
  fallbackColor: string,
): Promise<ParsedElement[]> {
  const content = await page.getTextContent();
  const rawItems = content.items.filter(
    (item): item is TextItem => "str" in item,
  );
  // Only trust the color timeline when it lines up 1:1 with the text items —
  // pdf.js can split one showText op into multiple items (or vice versa) for
  // heavily kerned text, and a misaligned zip would paint the wrong run the
  // wrong color, which is worse than the uniform default.
  const colorsAlign = textColors.length === rawItems.length;
  const boxes = rawItems
    .map((item, i) =>
      textItemToBox(
        item,
        viewportTransform,
        colorsAlign ? textColors[i] : fallbackColor,
      ),
    )
    .filter((b): b is TextRunBox => b !== undefined);
  if (boxes.length === 0) return [];

  const lines = groupIntoLines(boxes);
  const blocks = groupIntoBlocks(lines);

  return blocks.map((blockLines, index) => {
    const left = Math.min(...blockLines.map((l) => l.left));
    const top = Math.min(...blockLines.map((l) => l.top));
    const right = Math.max(...blockLines.map((l) => l.right));
    const bottom = Math.max(...blockLines.map((l) => l.bottom));
    const paragraphs: ParsedParagraph[] = blockLines.map((line) => ({
      runs: [
        {
          content: line.text,
          fontSize: line.fontSize,
          color: line.color,
          bold: line.bold,
          italic: line.italic,
        },
      ],
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

interface PageGraphics {
  imageRects: Rect[];
  /** The earliest fill covering most of the page — almost always the deck's background. */
  backgroundColor: string | undefined;
  /** Fill color active at each text-showing op, in operator-list order (for zipping against `getTextContent()` items). */
  textColors: string[];
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
async function walkPageGraphics(
  page: PDFPageProxy,
  viewport: { transform: Mat; width: number; height: number },
): Promise<PageGraphics> {
  const viewportTransform = viewport.transform;
  const opList = await page.getOperatorList();
  const imageRects: Rect[] = [];
  const textColors: string[] = [];
  let backgroundColor: string | undefined;
  let fillColor = DEFAULT_TEXT_COLOR;
  let ctm: Mat = [1, 0, 0, 1, 0, 0];
  const stack: { ctm: Mat; fillColor: string }[] = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[];
    if (fn === OPS.save) {
      stack.push({ ctm, fillColor });
    } else if (fn === OPS.restore) {
      const restored = stack.pop();
      if (restored) {
        ctm = restored.ctm;
        fillColor = restored.fillColor;
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
      textColors.push(fillColor);
    } else if (fn === OPS.constructPath) {
      const paintOp = args[0];
      const bbox = args[2] as number[] | undefined;
      if (
        backgroundColor === undefined &&
        FILL_PAINT_OPS.has(paintOp as number) &&
        bbox &&
        bbox.every((v) => Number.isFinite(v))
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
        const coversPage =
          rect.right - rect.left >=
            viewport.width * BACKGROUND_COVERAGE_RATIO &&
          rect.bottom - rect.top >= viewport.height * BACKGROUND_COVERAGE_RATIO;
        if (coversPage) backgroundColor = fillColor;
      }
    } else {
      const color = fillColorFromOp(fn, args as number[]);
      if (color) fillColor = color;
    }
  }
  return { imageRects, backgroundColor, textColors };
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
      const imageRects = graphics.imageRects;
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
        graphics.textColors,
        contrastingDefaultColor(graphics.backgroundColor),
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
