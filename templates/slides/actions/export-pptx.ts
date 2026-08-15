import fs from "fs";
import path from "path";

import { defineAction } from "@agent-native/core";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import type PptxGenJS from "pptxgenjs";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs
import { readLocalImportedAsset } from "../server/lib/import-asset-storage.js";
import {
  safeGeneratedFilename,
  tenantExportDir,
} from "../server/lib/tenant-files.js";
import {
  type AspectRatio,
  getAspectRatioDims,
  ASPECT_RATIO_VALUES,
} from "../shared/aspect-ratios.js";

type TableCell = PptxGenJS.TableCell;
type TableRow = PptxGenJS.TableRow;

/**
 * Extract inline style value for a given property from a style string.
 */
function getStyle(style: string, prop: string): string | null {
  const re = new RegExp(`${prop}\\s*:\\s*([^;]+)`, "i");
  const m = style.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Convert a CSS color string to a 6-char hex string (no #) plus an optional
 * pptxgenjs transparency (0-100, percent transparent) carried from an
 * alpha-bearing CSS color.
 * Handles #hex, #shortHex, rgb(), rgba(), and named colors.
 */
function colorToHex(color: string): { hex: string; transparency?: number } {
  if (!color) return { hex: "FFFFFF" };
  const parsed = parseCssColor(color);
  if (parsed) return parsed;
  console.warn(
    `[export-pptx] unrecognized color "${color}", defaulting to white`,
  );
  return { hex: "FFFFFF" };
}

/**
 * The recognition half of `colorToHex`, reporting `undefined` rather than white
 * for a value that is not a color at all. A caller that can act on "not a
 * color" — a gradient deciding whether its first argument is a direction or a
 * stop — must not be handed a color the source never contained.
 */
function parseCssColor(
  color: string,
): { hex: string; transparency?: number } | undefined {
  if (!color) return undefined;

  // Strip quotes / trim
  color = color.replace(/['"]/g, "").trim();

  // Already hex
  if (/^#[0-9a-f]{8}$/i.test(color)) {
    const alpha = parseInt(color.slice(7, 9), 16) / 255;
    return {
      hex: color.slice(1, 7).toUpperCase(),
      transparency: Math.round((1 - alpha) * 100),
    };
  }
  if (/^#[0-9a-f]{6}$/i.test(color))
    return { hex: color.slice(1).toUpperCase() };
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const r = color[1],
      g = color[2],
      b = color[3];
    return { hex: `${r}${r}${g}${g}${b}${b}`.toUpperCase() };
  }

  // rgb / rgba
  const rgbMatch = color.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/,
  );
  if (rgbMatch) {
    const hex = (n: string) => parseInt(n).toString(16).padStart(2, "0");
    const result = {
      hex: `${hex(rgbMatch[1])}${hex(rgbMatch[2])}${hex(rgbMatch[3])}`.toUpperCase(),
    };
    if (rgbMatch[4] === undefined) return result;
    const alpha = parseFloat(rgbMatch[4]);
    return { ...result, transparency: Math.round((1 - alpha) * 100) };
  }

  // Named colors used in the slide templates, plus the CSS Level 1 keyword set.
  const named: Record<string, string> = {
    white: "FFFFFF",
    black: "000000",
    transparent: "000000",
    silver: "C0C0C0",
    gray: "808080",
    grey: "808080",
    maroon: "800000",
    red: "FF0000",
    purple: "800080",
    fuchsia: "FF00FF",
    green: "008000",
    lime: "00FF00",
    olive: "808000",
    yellow: "FFFF00",
    navy: "000080",
    blue: "0000FF",
    teal: "008080",
    aqua: "00FFFF",
  };
  const hex = named[color.toLowerCase()];
  if (hex) return { hex };

  return undefined;
}

/**
 * Resolve a CSS `background`/`background-color` value to the single solid fill
 * PowerPoint can hold. pptxgenjs has no gradient fill (`ShapeFillProps.type` is
 * `'none' | 'solid'`), so a gradient must collapse to one stop — but dropping
 * the fill entirely, as this used to, exports the shape emptier than the source
 * rather than merely flatter. Pick the first stop that is not fully
 * transparent, which is the stop a `<a:gradFill>` leads with.
 */
function cssFillToSolid(
  value: string | null | undefined,
): { hex: string; transparency?: number } | undefined {
  if (!value) return undefined;
  if (!/gradient\(/i.test(value)) return colorToHex(value);
  for (const stop of value.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)) {
    const parsed = colorToHex(stop[0]);
    if ((parsed.transparency ?? 0) < 100) return parsed;
  }
  return undefined;
}

/** The deck templates' own family, used only when no HTML declares one. */
const DEFAULT_DECK_FONT_FACE = "Poppins";

/** First family name of a CSS `font-family` declaration, unquoted. */
function cssFontFace(style: string): string | undefined {
  return (
    getStyle(style, "font-family")
      ?.replace(/["']/g, "")
      .split(",")[0]
      ?.trim() || undefined
  );
}

/**
 * A preset name copied from `<a:prstGeom prst="...">` only survives if
 * PowerPoint knows it, and pptxgenjs writes whatever string it is handed
 * straight into `prst`. Report an unrecognized one the way `colorToHex`
 * reports an unreadable color instead of shipping a file PowerPoint rejects.
 */
export function resolveShapeType(
  shapeTypes: Record<string, string>,
  shapeType: string | undefined,
): PptxGenJS.ShapeType {
  if (!shapeType) return "rect" as PptxGenJS.ShapeType;
  const known = shapeTypes[shapeType];
  if (known) return known as PptxGenJS.ShapeType;
  console.warn(
    `[export-pptx] unrecognized shape geometry "${shapeType}", defaulting to a rectangle`,
  );
  return "rect" as PptxGenJS.ShapeType;
}

/**
 * CSS border styles PowerPoint can draw. `solid` needs no `dashType`, so it is
 * absent here; anything unlisted (`double`, `groove`, ...) also falls through to
 * a solid line, which is the closest single-stroke approximation.
 */
const CSS_BORDER_DASH_TYPES: Record<
  string,
  NonNullable<PptxGenJS.ShapeLineProps["dashType"]>
> = {
  dashed: "dash",
  dotted: "sysDot",
};

const CSS_BORDER_STYLE_PATTERN =
  /([\d.]+)px\s+(solid|dashed|dotted|double|groove|ridge|inset|outset)\s+(.+)/i;

interface ParsedCssBorder {
  widthPx: number;
  dashType?: NonNullable<PptxGenJS.ShapeLineProps["dashType"]>;
  color: string;
}

/**
 * PowerPoint's `a:spcPct val="100000"` is 100% of the font's *natural* line
 * height, which CSS renders as `line-height: 1.2`, so the importer multiplies a
 * declared percentage by that ratio. Writing the CSS value back out as `lnSpc`
 * unchanged applied that correction a second time, and every imported paragraph
 * came back 20% looser than the source. Neither copy of the constant is
 * exported — `SINGLE_LINE_SPACING_RATIO` in packages/core/src/ingestion/pptx.ts
 * and `DEFAULT_LINE_SPACING` in server/handlers/import/html-converter.ts — so
 * all three have to move together.
 */
const SINGLE_LINE_SPACING_RATIO = 1.2;

/** A CSS line-height ratio as the single-spacing multiple `lnSpc` measures. */
function cssLineHeightToSpacingMultiple(
  lineHeight: number | undefined,
): number | undefined {
  return lineHeight !== undefined &&
    Number.isFinite(lineHeight) &&
    lineHeight > 0
    ? lineHeight / SINGLE_LINE_SPACING_RATIO
    : undefined;
}

/** Parse a CSS `border` shorthand. `none`/`hidden` borders yield `undefined`. */
function parseCssBorder(
  border: string | null | undefined,
): ParsedCssBorder | undefined {
  const match = border?.match(CSS_BORDER_STYLE_PATTERN);
  if (!match) return undefined;
  return {
    widthPx: Number.parseFloat(match[1]),
    dashType: CSS_BORDER_DASH_TYPES[match[2].toLowerCase()],
    color: match[3],
  };
}

/**
 * Convert CSS px value to inches at a given slide width.
 * The mapping depends on the aspect ratio: pxPerIn = pxWidth / inchWidth.
 */
function pxToIn(
  px: number,
  dims: { width: number; pptxInches: { w: number } },
): number {
  return (px / dims.width) * dims.pptxInches.w;
}

/**
 * Convert CSS font-size px to PowerPoint points, using this deck's actual
 * px/inch ratio (like `pxToIn` above) instead of assuming 96 CSS px/inch —
 * the ratio varies by aspect ratio (72 for 16:9/9:16, 108 for 1:1/4:5).
 */
function pxToPt(
  px: number,
  dims: { width: number; pptxInches: { w: number } },
): number {
  const pxPerInch = dims.width / dims.pptxInches.w;
  return Math.round((px / pxPerInch) * 72);
}

const EMU_PER_INCH = 914400;

/**
 * The page size an imported slide carries from its source `<p:sldSz>`. The
 * importer lays elements out against the nearest `ASPECT_RATIOS` preset box, so
 * exporting onto that preset's inches instead re-pages the deck: a 10x5.625in
 * source comes back 13.33x7.5in, and a 16:10 source (creandum) comes back 16:9
 * with every element stretched 11% vertically, because the preset it snapped to
 * is not its real shape. Scaling the preset's px box onto the source's own
 * inches makes both round trips exact.
 */
export function sourcePageInches(
  html: string,
): { w: number; h: number } | undefined {
  const widthEmu = Number(html.match(/data-slide-width-emu="(\d+)"/)?.[1]);
  const heightEmu = Number(html.match(/data-slide-height-emu="(\d+)"/)?.[1]);
  if (!widthEmu || !heightEmu) return undefined;
  const w = widthEmu / EMU_PER_INCH;
  const h = heightEmu / EMU_PER_INCH;
  // PowerPoint itself refuses a page outside 1-56in; a value beyond that is a
  // corrupt attribute, not a page size, and must not silently re-page the deck.
  if (w < 1 || w > 56 || h < 1 || h > 56) {
    console.warn(
      `[export-pptx] ignoring out-of-range source page size ${widthEmu}x${heightEmu} EMU`,
    );
    return undefined;
  }
  return { w, h };
}

/** `dims` re-based onto the source page size when the slide declares one. */
function withSourcePageInches(dims: SlideDims, html: string): SlideDims {
  const pptxInches = sourcePageInches(html);
  return pptxInches ? { ...dims, pptxInches } : dims;
}

interface TextElement {
  text: string;
  fontSize?: number; // in pt; omitted when the source declares none
  fontFace?: string; // omitted when the source declares none
  color: string; // 6-char hex
  transparency?: number; // 0-100, percent transparent
  bold: boolean;
  x: number; // inches
  y: number; // inches
  w: number; // inches
  h: number; // inches
  align?: "left" | "center" | "right";
  letterSpacing?: number;
  lineSpacingMultiple?: number;
  runs?: TextRunElement[];
  rotate?: number; // degrees clockwise
  order?: number;
}

interface TextRunElement {
  text: string;
  options: {
    fontSize?: number;
    fontFace?: string;
    color?: string;
    transparency?: number; // 0-100, percent transparent
    bold?: boolean;
    italic?: boolean;
    underline?: { style: "sng" };
  };
}

interface ImageElement {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate?: number; // degrees clockwise
  order?: number;
}

interface ShapeElement {
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  fillTransparency?: number; // 0-100, percent transparent
  lineColor?: string;
  lineTransparency?: number; // 0-100, percent transparent
  lineWidth?: number; // in pt
  lineDashType?: NonNullable<PptxGenJS.ShapeLineProps["dashType"]>;
  lineHeadType?: NonNullable<PptxGenJS.ShapeLineProps["beginArrowType"]>;
  lineTailType?: NonNullable<PptxGenJS.ShapeLineProps["endArrowType"]>;
  /** A PowerPoint preset geometry name, or `custGeom` when `points` carry a traced outline. */
  shapeType?: string;
  rectRadius?: number; // inches; roundRect corner radius
  points?: PptxGenJS.ShapeProps["points"];
  rotate?: number; // degrees clockwise
  order?: number;
}

interface TableElement {
  rows: TableRow[];
  x: number;
  y: number;
  w: number;
  h: number;
  /** Per-column widths in inches, from the source `a:tblGrid`; absent when the HTML declares none. */
  colW?: number[];
  /** Per-row heights in inches, from the source `a:tr/@h`; absent when the HTML declares none. */
  rowH?: number[];
  order?: number;
}

interface GridElement {
  color: string;
  transparency?: number; // 0-100, percent transparent
  stepX: number;
  stepY: number;
  offsetX: number;
  offsetY: number;
  lineWidth: number;
}

export function assertServerPptxExportable(
  html: string,
  slideNumber: number,
): void {
  // Absolute positioning alone is not an editing-object contract: uploaded
  // backgrounds are intentionally absolute but the normal-flow exporter can
  // still include them. Only reject objects persisted by the freeform editor.
  const hasPersistedFreeformObject =
    /\bdata-slide-object-id\s*=/i.test(html) ||
    /\bclass\s*=\s*["'][^"']*\bfmd-freeform-object\b/i.test(html);
  if (html.includes('data-imported-pptx="true"')) return;
  if (!hasPersistedFreeformObject) return;

  const error = new Error(
    `Slide ${slideNumber} contains freeform positioned objects. Export this deck from the Slides editor with Export > PowerPoint so browser-rendered geometry is preserved. The server export stopped instead of silently reflowing those objects.`,
  );
  error.name = "UnsupportedPositionedSlideExportError";
  throw error;
}

interface ParsedSlide {
  texts: TextElement[];
  images: ImageElement[];
  shapes: ShapeElement[];
  tables: TableElement[];
  grid?: GridElement;
  bgColor: string;
  bgTransparency?: number; // 0-100, percent transparent
  /** The slide background's CSS gradient, when it has one. `bgColor` still holds its flattened stop for the shape-level path. */
  bgGradient?: string;
}

/**
 * Parse slide HTML and extract text/image elements with positioning.
 * We know the exact HTML structure from the slide templates.
 */
export function parseSlideHtml(
  html: string,
  aspectRatio?: AspectRatio,
  slideNumber = 1,
): ParsedSlide {
  assertServerPptxExportable(html, slideNumber);
  const dims = withSourcePageInches(getAspectRatioDims(aspectRatio), html);
  if (html.includes('data-imported-pdf="true"')) {
    return parseImportedPdfSlideHtml(html, dims);
  }
  if (html.includes('data-imported-pptx="true"')) {
    return parseImportedSlideHtml(html, dims);
  }

  const texts: TextElement[] = [];
  const images: ImageElement[] = [];
  const shapes: ShapeElement[] = [];
  let bgColor = "000000";
  let bgTransparency: number | undefined;

  const slideW = dims.pptxInches.w;
  const slideH = dims.pptxInches.h;

  // Check for background color on the outer .fmd-slide div
  const slideStyleMatch = html.match(/class="fmd-slide"[^>]*style="([^"]*)"/);
  const slideBackground = slideStyleMatch
    ? getStyle(slideStyleMatch[1], "background(?:-color)?")
    : null;
  const bgGradient =
    slideBackground && /gradient\(/i.test(slideBackground)
      ? slideBackground
      : undefined;
  const parsedBg = cssFillToSolid(slideBackground);
  if (parsedBg) {
    bgColor = parsedBg.hex;
    bgTransparency = parsedBg.transparency;
  }
  // Deck templates set the family once on the wrapper; individual headings and
  // paragraphs only override it. Reading it is what keeps a Work Sans or
  // Montserrat design system from exporting as this template's default.
  const slideFontFace = slideStyleMatch
    ? cssFontFace(slideStyleMatch[1])
    : undefined;

  // Extract padding from the .fmd-slide wrapper
  const paddingStr = slideStyleMatch
    ? getStyle(slideStyleMatch[1], "padding")
    : null;
  let padTop = 80,
    padLeft = 110;
  if (paddingStr) {
    const parts = paddingStr.split(/\s+/).map((s) => parseInt(s));
    if (parts.length >= 2) {
      padTop = parts[0] || 80;
      padLeft = parts[1] || 110;
    }
  }

  const xMargin = pxToIn(padLeft, dims);
  const contentW = slideW - 2 * xMargin;
  let yPos = pxToIn(padTop, dims);

  // Check if the slide is vertically centered (justify-content: center)
  const isCentered =
    slideStyleMatch && slideStyleMatch[1].includes("justify-content: center");

  // Collect all elements in order for vertical layout
  let match;
  interface ParsedEl {
    tag: string;
    style: string;
    innerHtml: string;
    index: number;
  }
  const elements: ParsedEl[] = [];

  // Find top-level elements inside the .fmd-slide div
  // Skip the outer wrapper div itself
  const innerContent = html.replace(
    /^<div[^>]*class="fmd-slide"[^>]*>([\s\S]*)<\/div>\s*$/i,
    "$1",
  );

  // Parse top-level elements from inner content
  const topLevelRegex = /<(h1|h2|h3|p|div)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  while ((match = topLevelRegex.exec(innerContent)) !== null) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    const inner = match[3];

    // Extract style
    const styleMatch = attrs.match(/style="([^"]*)"/);
    const style = styleMatch ? styleMatch[1] : "";

    elements.push({
      tag,
      style,
      innerHtml: inner,
      index: match.index,
    });
  }

  // If centered, estimate the content height and adjust starting Y
  if (isCentered && elements.length > 0) {
    let totalHeight = 0;
    for (const el of elements) {
      const fs = getStyle(el.style, "font-size");
      const fontSize = fs ? parseInt(fs) : 22;
      const mb = getStyle(el.style, "margin");
      let marginBottom = 0;
      if (mb) {
        const parts = mb.split(/\s+/).map((s) => parseInt(s));
        // margin: top right bottom left or margin: vert horiz
        if (parts.length === 4) marginBottom = parts[2] || 0;
        else if (parts.length === 2) marginBottom = parts[0] || 0;
        else marginBottom = parts[0] || 0;
      }
      totalHeight += fontSize * 1.3 + marginBottom;
    }
    yPos = (slideH - pxToIn(totalHeight, dims)) / 2;
    if (yPos < pxToIn(padTop, dims)) yPos = pxToIn(padTop, dims);
  }

  for (const el of elements) {
    const style = el.style;
    const fs = getStyle(style, "font-size");
    const fontSize = fs ? parseInt(fs) : 22;
    const fontWeight = getStyle(style, "font-weight");
    const bold =
      fontWeight !== null &&
      (parseInt(fontWeight) >= 700 || fontWeight === "bold");
    const color = getStyle(style, "(?<!background-)color") || "#FFFFFF";
    const letterSpacing = getStyle(style, "letter-spacing");
    const lineHeight = getStyle(style, "line-height");

    // Extract text from inner HTML, stripping nested tags
    const text = el.innerHtml
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&ldquo;/g, "“")
      .replace(/&rdquo;/g, "”")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#x25CF;/g, "●")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/&#x[0-9a-f]+;/gi, "")
      .trim();

    if (!text && !el.innerHtml.includes("<img")) continue;

    // Check for images within this element
    const imgRegex =
      /<img[^>]*src="([^"]*)"[^>]*(?:style="([^"]*)")?[^>]*\/?>/gi;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(el.innerHtml)) !== null) {
      const imgSrc = imgMatch[1];
      const imgStyle = imgMatch[2] || "";
      const imgW = getStyle(imgStyle, "width");
      const imgH = getStyle(imgStyle, "height");
      images.push({
        src: imgSrc,
        x: xMargin,
        y: yPos,
        w: imgW ? pxToIn(parseInt(imgW), dims) : contentW,
        h: imgH ? pxToIn(parseInt(imgH), dims) : pxToIn(300, dims),
      });
      yPos += imgH
        ? pxToIn(parseInt(imgH), dims) + 0.2
        : pxToIn(300, dims) + 0.2;
    }

    if (text) {
      // Calculate element height based on font size and line count
      const lineCount = Math.max(1, text.split("\n").length);
      const lineH = lineHeight ? parseFloat(lineHeight) : 1.3;
      const elHeight = pxToIn(fontSize * lineH * lineCount, dims);

      // Extract margin-bottom
      const marginStr = getStyle(style, "margin");
      let marginBottom = 0;
      if (marginStr) {
        const parts = marginStr.split(/\s+/).map((s) => parseInt(s));
        if (parts.length === 4) marginBottom = parts[2] || 0;
        else if (parts.length >= 2)
          marginBottom = 0; // margin: 0 0 = no bottom
        else marginBottom = parts[0] || 0;
      }
      const mbStr = getStyle(style, "margin-bottom");
      if (mbStr) marginBottom = parseInt(mbStr) || 0;

      const parsedColor = colorToHex(color);
      texts.push({
        text,
        fontSize: pxToPt(fontSize, dims),
        fontFace: cssFontFace(style) ?? slideFontFace ?? DEFAULT_DECK_FONT_FACE,
        color: parsedColor.hex,
        transparency: parsedColor.transparency,
        bold,
        x: xMargin,
        y: yPos,
        w: contentW,
        h: elHeight + 0.2,
        letterSpacing: letterSpacing ? parseFloat(letterSpacing) : undefined,
        lineSpacingMultiple: cssLineHeightToSpacingMultiple(lineH),
      });

      yPos += elHeight + pxToIn(marginBottom, dims) + 0.1;
    }
  }

  return {
    texts,
    images,
    shapes,
    tables: [],
    bgColor,
    bgTransparency,
    ...(bgGradient ? { bgGradient } : {}),
  };
}

/**
 * Structural rather than `ReturnType<typeof getAspectRatioDims>`: the px box
 * stays the aspect-ratio preset the importer laid out against, while
 * `pptxInches` is re-based onto the source page size, so the two halves no
 * longer come from the same preset literal.
 */
interface SlideDims {
  width: number;
  height: number;
  pptxInches: { w: number; h: number };
}

/**
 * The `.fmd-slide` wrapper's inline style. The delimiter has to be captured and
 * back-referenced: the importer writes `font-family: 'Work Sans', sans-serif`
 * into a double-quoted attribute, so a naive `[^"']*` body silently truncates
 * the style at the first font name and hides every declaration after it.
 */
function slideWrapperStyle(html: string): string | undefined {
  return html.match(
    /class=(["'])[^"']*\bfmd-slide\b[^"']*\1[^>]*\bstyle=(["'])([\s\S]*?)\2/i,
  )?.[3];
}

function parseImportedPdfSlideHtml(html: string, dims: SlideDims): ParsedSlide {
  const outerStyle = slideWrapperStyle(html);
  const parsedBg = colorToHex(
    outerStyle
      ? (getStyle(outerStyle, "background(?:-color)?") ?? "#000000") // guard:allow-raw-color - imported PDF fallback
      : "#000000", // guard:allow-raw-color - imported PDF fallback
  );
  const bgColor = parsedBg.hex;
  const bgTransparency = parsedBg.transparency;
  const src = html.match(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i)?.[1];
  const outerAttrs = html.match(/<div\b([^>]*)>/i)?.[1] ?? "";
  const sourceWidth = Number.parseFloat(
    getAttribute(outerAttrs, "data-source-width") ?? "",
  );
  const sourceHeight = Number.parseFloat(
    getAttribute(outerAttrs, "data-source-height") ?? "",
  );
  let x = 0;
  let y = 0;
  let w = dims.pptxInches.w;
  let h = dims.pptxInches.h;
  if (
    Number.isFinite(sourceWidth) &&
    Number.isFinite(sourceHeight) &&
    sourceWidth > 0 &&
    sourceHeight > 0
  ) {
    const sourceAspect = sourceWidth / sourceHeight;
    const deckAspect = dims.pptxInches.w / dims.pptxInches.h;
    if (sourceAspect > deckAspect) {
      h = w / sourceAspect;
      y = (dims.pptxInches.h - h) / 2;
    } else {
      w = h * sourceAspect;
      x = (dims.pptxInches.w - w) / 2;
    }
  }
  return {
    texts: [],
    images: src
      ? [
          {
            src: decodeHtmlText(src),
            x,
            y,
            w,
            h,
            order: 0,
          },
        ]
      : [],
    shapes: [],
    tables: [],
    bgColor,
    bgTransparency,
  };
}

// Must stay identical to `DEFAULT_PPTX_BACKGROUND` / `DEFAULT_PPTX_FOREGROUND`
// in server/handlers/import/html-converter.ts. Export previously inverted both
// (black background, white text), so an undecorated slide came back out of a
// round trip with its colors flipped rather than unchanged.
const IMPORTED_PPTX_BACKGROUND_FALLBACK = "#ffffff"; // guard:allow-raw-color - mirrors the importer's PPTX default
const IMPORTED_PPTX_FOREGROUND_FALLBACK = "111827"; // guard:allow-raw-color - mirrors the importer's PPTX default

function parseImportedSlideHtml(html: string, dims: SlideDims): ParsedSlide {
  const texts: TextElement[] = [];
  const images: ImageElement[] = [];
  const shapes: ShapeElement[] = [];
  const tables: TableElement[] = [];
  const outerStyle = slideWrapperStyle(html);
  const background = outerStyle
    ? getStyle(outerStyle, "background(?:-color)?")
    : undefined;
  const parsedBg =
    cssFillToSolid(background) ?? colorToHex(IMPORTED_PPTX_BACKGROUND_FALLBACK);
  const bgColor = parsedBg.hex;
  const bgTransparency = parsedBg.transparency;
  const bgGradient =
    background && /gradient\(/i.test(background) ? background : undefined;
  const slideFontFace = outerStyle ? cssFontFace(outerStyle) : undefined;
  const grid = outerStyle ? parseImportedGrid(outerStyle) : undefined;
  const elementRegex =
    /<div\b([^>]*\bdata-pptx-element-kind=["'](text|image|shape|table)["'][^>]*)>([\s\S]*?)<\/div>/gi;
  let match: RegExpExecArray | null;
  while ((match = elementRegex.exec(html)) !== null) {
    const attrs = match[1];
    const kind = match[2].toLowerCase();
    const innerHtml = match[3];
    const style = getAttribute(attrs, "style") ?? "";
    const geometry = importedGeometry(style, dims);
    if (!geometry) continue;
    const rotate = importedRotation(style);

    if (kind === "image") {
      const imageAttrs = innerHtml.match(/<img\b([^>]*)>/i)?.[1] ?? "";
      const src = getAttribute(imageAttrs, "src");
      if (src) {
        images.push({
          src,
          ...geometry,
          ...(rotate != null ? { rotate } : {}),
          order: match.index,
        });
      }
      continue;
    }

    if (kind === "shape") {
      const parsedFill = cssFillToSolid(
        getStyle(style, "background(?:-color)?"),
      );
      const border = parseCssBorder(getStyle(style, "border"));
      const parsedLine = border ? colorToHex(border.color) : undefined;
      const outline = importedFreeformStroke(innerHtml, dims);
      const line = importedLineStroke(style, innerHtml, dims);
      shapes.push({
        ...geometry,
        ...(parsedFill
          ? { fill: parsedFill.hex, fillTransparency: parsedFill.transparency }
          : {}),
        ...(border && parsedLine
          ? {
              lineColor: parsedLine.hex,
              lineTransparency: parsedLine.transparency,
              // `pxToPt` rounds, so a hairline needs the same 0.5pt floor the
              // table borders use or the outline rounds away to nothing.
              lineWidth: Math.max(0.5, pxToPt(border.widthPx, dims)),
              ...(border.dashType ? { lineDashType: border.dashType } : {}),
            }
          : outline
            ? {
                lineColor: outline.color.hex,
                lineTransparency: outline.color.transparency,
                lineWidth: outline.width,
              }
            : {}),
        ...importedShapeGeometry(attrs, style, outline?.path, geometry, dims),
        // A single-edge border is the importer's own verdict that this box is a
        // line rather than an outline, so it settles the geometry too.
        ...line,
        ...(rotate != null ? { rotate } : {}),
        order: match.index,
      });
      continue;
    }

    if (kind === "table") {
      const rows = importedTableRows(innerHtml, dims);
      if (rows.length > 0) {
        tables.push({
          ...geometry,
          rows,
          ...importedTableTracks(innerHtml, rows, geometry),
          order: match.index,
        });
      }
      continue;
    }

    const runs = importedTextRuns(innerHtml, dims);
    const firstRun = runs.find((run) => run.text.trim()) ?? runs[0];
    const firstParagraph = innerHtml.match(
      /<p\b[^>]*style=["']([^"']*)["']/i,
    )?.[1];
    const lineHeight = firstParagraph
      ? getStyle(firstParagraph, "line-height")
      : null;
    const alignValue = getStyle(style, "text-align");
    // Per-run faces still win inside `addText`; this only supplies the
    // box-level default for runs that declare none, so it must be the source
    // deck's own theme font rather than this template's.
    const boxFontFace = firstRun?.options.fontFace ?? slideFontFace;
    texts.push({
      text: runs.map((run) => run.text).join(""),
      ...(firstRun?.options.fontSize != null
        ? { fontSize: firstRun.options.fontSize }
        : {}),
      ...(boxFontFace ? { fontFace: boxFontFace } : {}),
      color: firstRun?.options.color ?? IMPORTED_PPTX_FOREGROUND_FALLBACK,
      transparency: firstRun?.options.transparency,
      // pptxgenjs copies a box-level option onto any run whose own value is
      // falsy (`!textObj.options[key]`), so a box default of `bold: true` taken
      // from the first run overwrites every later run that said `bold: false` —
      // a bold heading made its whole text box bold. The box may only default
      // to bold when the runs already agree.
      bold: runs.length > 0 && runs.every((run) => run.options.bold === true),
      align:
        alignValue === "center" || alignValue === "right" ? alignValue : "left",
      lineSpacingMultiple: cssLineHeightToSpacingMultiple(
        lineHeight ? Number(lineHeight) : undefined,
      ),
      x: geometry.x,
      y: geometry.y,
      w: geometry.w,
      h: geometry.h,
      runs,
      ...(rotate != null ? { rotate } : {}),
      order: match.index,
    });
  }

  return {
    texts,
    images,
    shapes,
    tables,
    grid,
    bgColor,
    bgTransparency,
    ...(bgGradient ? { bgGradient } : {}),
  };
}

function parseImportedGrid(style: string): GridElement | undefined {
  const backgroundImage = getStyle(style, "background-image");
  const size = getStyle(style, "background-size")
    ?.split(/\s+/)
    .map((value) => Number.parseFloat(value));
  const position = getStyle(style, "background-position")
    ?.split(/\s+/)
    .map((value) => Number.parseFloat(value));
  const color = backgroundImage?.match(/#[0-9a-f]{6}|rgb\([^)]*\)/i)?.[0];
  const lineWidth = backgroundImage?.match(/\s0\s+([\d.]+)px/i)?.[1];
  if (
    !color ||
    !size ||
    size.length < 2 ||
    !Number.isFinite(size[0]) ||
    !Number.isFinite(size[1]) ||
    size[0] <= 0 ||
    size[1] <= 0 ||
    !position ||
    position.length < 2 ||
    !Number.isFinite(position[0]) ||
    !Number.isFinite(position[1]) ||
    !lineWidth
  ) {
    return undefined;
  }
  const parsedColor = colorToHex(color);
  return {
    color: parsedColor.hex,
    transparency: parsedColor.transparency,
    stepX: size[0],
    stepY: size[1],
    offsetX: position[0],
    offsetY: position[1],
    lineWidth: Number.parseFloat(lineWidth),
  };
}

function importedGeometry(
  style: string,
  dims: SlideDims,
): { x: number; y: number; w: number; h: number } | null {
  const left = cssPx(style, "left");
  const top = cssPx(style, "top");
  const width = cssPx(style, "width");
  const height = cssPx(style, "height");
  if (left == null || top == null || width == null || height == null)
    return null;
  return {
    x: pxToIn(left, dims),
    y: pxToInY(top, dims),
    w: pxToIn(width, dims),
    h: pxToInY(height, dims),
  };
}

function pxToInY(px: number, dims: SlideDims): number {
  return (px / dims.height) * dims.pptxInches.h;
}

/**
 * The `<a:xfrm rot="...">` the importer rendered as `transform: rotate(Ndeg)`.
 * Dropping it exports a rotated object square to the slide, which on a ring of
 * six curved arrows leaves six copies of the same arrow stacked at the top
 * rather than a ring.
 */
function importedRotation(style: string): number | undefined {
  const degrees = Number.parseFloat(
    getStyle(style, "transform")?.match(
      /rotate\(\s*(-?[\d.]+)deg\s*\)/i,
    )?.[1] ?? "",
  );
  return Number.isFinite(degrees) && degrees !== 0 ? degrees : undefined;
}

/**
 * Recover the shape's PowerPoint geometry. `<a:prstGeom prst="...">` is the
 * only lossless carrier — CSS cannot distinguish a trapezoid from a hexagon
 * once both are `clip-path: polygon(...)` — so the importer's
 * `data-pptx-shape-type` attribute wins when present. Otherwise trace what CSS
 * can prove: a freeform outline and a polygon become custom outlines, and a
 * border radius becomes an ellipse or a real corner radius instead of
 * pptxgen's default roundRect.
 */
function importedShapeGeometry(
  attrs: string,
  style: string,
  strokeOutline: string | undefined,
  size: { w: number; h: number },
  dims: SlideDims,
): Pick<ShapeElement, "shapeType" | "rectRadius" | "points"> {
  const preset = getAttribute(attrs, "data-pptx-shape-type");
  if (preset) return { shapeType: preset };

  const clipPath = getStyle(style, "clip-path");
  // A stroke-only freeform carries no clip (clipping an unfilled box would eat
  // half the stroke), so its overlay path is the only outline it has.
  const outline =
    clipPath?.match(/path\(\s*(["']?)([^"')]*)\1\s*\)/i)?.[2] ?? strokeOutline;
  if (outline) {
    const points = svgPathPoints(outline, dims);
    if (points) return { shapeType: "custGeom", points };
  }

  const polygon = clipPath?.match(/polygon\(([^)]*)\)/i)?.[1];
  if (polygon) {
    const points = clipPathPolygonPoints(polygon, size, dims);
    if (points) return { shapeType: "custGeom", points };
  }

  const radius = getStyle(style, "border-radius")?.split(/\s+/)[0];
  if (!radius) return {};
  const shortSide = Math.min(size.w, size.h);
  const value = Number.parseFloat(radius);
  if (!Number.isFinite(value) || value <= 0) return {};
  if (radius.endsWith("%")) {
    return value >= 50
      ? { shapeType: "ellipse" }
      : { shapeType: "roundRect", rectRadius: (value / 100) * shortSide };
  }
  return {
    shapeType: "roundRect",
    // A pill (`border-radius: 9999px`) clamps to the half-side PowerPoint caps
    // its `adj` value at, rather than overflowing the shape.
    rectRadius: Math.min(pxToIn(value, dims), shortSide / 2),
  };
}

/**
 * A freeform outline's stroke follows the path, not the box, so the importer
 * draws it as an SVG overlay instead of a `border`. Read that overlay back:
 * it carries the shape's line color and width, and for a line-art pictogram —
 * no fill, so nothing to clip — it is the only copy of the outline itself.
 */
function importedFreeformStroke(
  innerHtml: string,
  dims: SlideDims,
):
  | { path: string; color: ReturnType<typeof colorToHex>; width: number }
  | undefined {
  const pathAttrs = innerHtml.match(/<svg\b[^>]*>\s*<path\b([^>]*)>/i)?.[1];
  if (!pathAttrs) return undefined;
  const path = getAttribute(pathAttrs, "d");
  const stroke = getAttribute(pathAttrs, "stroke");
  if (!path || !stroke) return undefined;
  const widthPx = Number.parseFloat(
    getAttribute(pathAttrs, "stroke-width") ?? "1",
  );
  return {
    path: decodeHtmlText(path),
    color: colorToHex(stroke),
    // The same 0.5pt floor the CSS-border path uses: `pxToPt` rounds, and a
    // hairline outline that rounds to 0pt is an invisible shape.
    width: Math.max(0.5, pxToPt(Number.isFinite(widthPx) ? widthPx : 1, dims)),
  };
}

/** The line axis each single-edge border the importer writes draws along. */
const SINGLE_EDGE_BORDER_AXES = {
  "border-top": "x",
  "border-left": "y",
} as const;

/**
 * The stroke of a `<p:cxnSp>` or a degenerate `<p:sp>` — a box with one
 * dimension of zero. The importer draws those with a single `border-left` or
 * `border-top` rather than the `border` shorthand (`strokeDecoration` in
 * server/handlers/import/html-converter.ts), which `parseCssBorder` above
 * cannot see, so every connector used to export as a `rect` of `cx="0"` with
 * `<a:noFill/>` and an empty `<a:ln/>`: no width, no color, no ends, nothing
 * drawn. Reading the edge the importer actually wrote gives back the real line.
 */
function importedLineStroke(
  style: string,
  innerHtml: string,
  dims: SlideDims,
):
  | Pick<
      ShapeElement,
      | "shapeType"
      | "lineColor"
      | "lineTransparency"
      | "lineWidth"
      | "lineDashType"
      | "lineHeadType"
      | "lineTailType"
    >
  | undefined {
  for (const [property, axis] of Object.entries(SINGLE_EDGE_BORDER_AXES)) {
    const border = parseCssBorder(getStyle(style, property));
    if (!border) continue;
    const color = colorToHex(border.color);
    return {
      shapeType: "line",
      lineColor: color.hex,
      lineTransparency: color.transparency,
      // The same 0.5pt floor the outline paths use, for the same reason:
      // `pxToPt` rounds, and a hairline that rounds to 0pt draws nothing.
      lineWidth: Math.max(0.5, pxToPt(border.widthPx, dims)),
      ...(border.dashType ? { lineDashType: border.dashType } : {}),
      ...importedLineEndTypes(innerHtml, axis),
    };
  }
  return undefined;
}

/**
 * The `<a:headEnd>`/`<a:tailEnd>` the importer redraws as absolutely
 * positioned `<circle>` overlays (`lineEndCaps` in html-converter.ts). It only
 * ever reproduces `oval`, and it centers the overlay on the line, so a circle
 * before the viewBox midpoint caps the head and one after it caps the tail —
 * still true for a flipped source, because the importer swapped the two before
 * drawing them.
 */
function importedLineEndTypes(
  innerHtml: string,
  axis: "x" | "y",
): Pick<ShapeElement, "lineHeadType" | "lineTailType"> {
  const svg = innerHtml.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
  const viewBox = getAttribute(svg?.[1] ?? "", "viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!svg || viewBox?.length !== 4 || !viewBox.every(Number.isFinite)) {
    return {};
  }
  const middle = (axis === "x" ? viewBox[2] : viewBox[3]) / 2;
  const ends: Pick<ShapeElement, "lineHeadType" | "lineTailType"> = {};
  for (const circle of svg[2].matchAll(/<circle\b([^>]*)>/gi)) {
    const along = Number(getAttribute(circle[1], axis === "x" ? "cx" : "cy"));
    if (!Number.isFinite(along)) continue;
    if (along < middle) ends.lineHeadType = "oval";
    else ends.lineTailType = "oval";
  }
  return ends;
}

type CustomGeometryPoint = NonNullable<ShapeElement["points"]>[number];

/** Numbers each SVG path command consumes. The importer emits only these. */
const SVG_PATH_ARITY: Record<string, number> = {
  M: 2,
  L: 2,
  Q: 4,
  C: 6,
  A: 7,
};

/**
 * One SVG number. The importer writes path data in its shortest legal
 * spelling — `-1.7 0-1.2-.2` is four numbers, not one token per space — so
 * splitting on whitespace reads a 200-country map as a single unreadable
 * command and exports the whole thing as rectangles.
 */
const SVG_PATH_NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

/**
 * Trace the importer's freeform outline — `clip-path: path('...')`, or the
 * stroke overlay it draws for an unfilled one — as pptxgenjs custom geometry.
 * Every command `customGeometryPath`/`blockArcPath` emit has an exact
 * counterpart in `ShapeProps.points`: `moveTo`/`lnTo` are bare points and
 * `cubicBezTo`/`quadBezTo`/`arcTo` are its three curve types, so nothing is
 * flattened. Coordinates are the shape's own pixel box, which converts to the
 * inches `addShape` writes into `<a:path>` the same way a polygon's do.
 *
 * Returns `undefined` rather than a partial outline when a command cannot be
 * read, so the caller falls back to a whole rectangle instead of exporting a
 * fragment of the shape.
 */
function svgPathPoints(
  path: string,
  dims: SlideDims,
): NonNullable<ShapeElement["points"]> | undefined {
  const points: CustomGeometryPoint[] = [];
  const toX = (px: number) => pxToIn(px, dims);
  const toY = (px: number) => pxToInY(px, dims);
  let cursorX = 0;
  let cursorY = 0;
  let subpathX = 0;
  let subpathY = 0;
  let seenCommand = false;

  for (const match of path.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const command = match[1].toUpperCase();
    const relative = match[1] !== command;
    seenCommand = true;
    const args = (match[2].match(SVG_PATH_NUMBER) ?? []).map(Number);
    if (command === "Z") {
      if (args.length > 0) return undefined;
      points.push({ close: true });
      // `z` returns the pen to where the subpath started; the next relative
      // command steps from there, not from the last point drawn.
      cursorX = subpathX;
      cursorY = subpathY;
      continue;
    }
    const arity = SVG_PATH_ARITY[command];
    if (
      !arity ||
      args.length === 0 ||
      args.length % arity !== 0 ||
      args.some((value) => !Number.isFinite(value))
    ) {
      console.warn(
        `[export-pptx] unreadable SVG path command "${match[0].trim().slice(0, 40)}" in a shape outline; exported as a rectangle`,
      );
      return undefined;
    }
    for (let i = 0; i < args.length; i += arity) {
      const chunk = args.slice(i, i + arity);
      // A relative command steps from the point its own segment starts at —
      // including a curve's control points, which are offsets from that same
      // point rather than from each other.
      const originX = relative ? cursorX : 0;
      const originY = relative ? cursorY : 0;
      const atX = (index: number) => originX + chunk[index];
      const atY = (index: number) => originY + chunk[index];
      const endX = atX(arity - 2);
      const endY = atY(arity - 1);
      if (command === "M") {
        // A repeated pair after `M` is an implicit lineto, and every `M` past
        // the first opens a subpath pptxgenjs only reopens for `moveTo`.
        points.push(
          i === 0
            ? { x: toX(endX), y: toY(endY), moveTo: true }
            : { x: toX(endX), y: toY(endY) },
        );
        if (i === 0) {
          subpathX = endX;
          subpathY = endY;
        }
      } else if (command === "L") {
        points.push({ x: toX(endX), y: toY(endY) });
      } else if (command === "C") {
        points.push({
          x: toX(endX),
          y: toY(endY),
          curve: {
            type: "cubic",
            x1: toX(atX(0)),
            y1: toY(atY(1)),
            x2: toX(atX(2)),
            y2: toY(atY(3)),
          },
        });
      } else if (command === "Q") {
        points.push({
          x: toX(endX),
          y: toY(endY),
          curve: { type: "quadratic", x1: toX(atX(0)), y1: toY(atY(1)) },
        });
      } else {
        // Only an arc's endpoint is relative: its radii and flags are not
        // coordinates.
        const arc = svgArcToPptxCurve(
          cursorX,
          cursorY,
          [...chunk.slice(0, 5), endX, endY],
          dims,
        );
        if (!arc) return undefined;
        points.push(arc);
      }
      cursorX = endX;
      cursorY = endY;
    }
  }

  if (!seenCommand) return undefined;
  return points.length > 0 ? points : undefined;
}

/**
 * `<a:arcTo>` names an arc by its radii and its start/swing angles around a
 * center it derives from the current point; SVG's `A` names the same arc by
 * its endpoint plus two flags. This is the SVG spec's endpoint-to-center
 * conversion (F.6.5) with the x-axis rotation the importer never emits left
 * out, so the ring segments and rounded freeforms come back as true arcs
 * rather than as chords across them.
 */
function svgArcToPptxCurve(
  startX: number,
  startY: number,
  [radiusX, radiusY, rotation, largeArc, sweep, endX, endY]: number[],
  dims: SlideDims,
): CustomGeometryPoint | undefined {
  if (rotation !== 0) {
    console.warn(
      `[export-pptx] rotated elliptical arc (${rotation}deg) in a shape outline; exported as a rectangle`,
    );
    return undefined;
  }
  const point = { x: pxToIn(endX, dims), y: pxToInY(endY, dims) };
  let rx = Math.abs(radiusX);
  let ry = Math.abs(radiusY);
  // A zero radius is a straight line in SVG, and PowerPoint draws nothing at
  // all for one.
  if (!(rx > 0) || !(ry > 0)) return point;

  const midX = (startX - endX) / 2;
  const midY = (startY - endY) / 2;
  const scale = (midX * midX) / (rx * rx) + (midY * midY) / (ry * ry);
  if (scale > 1) {
    rx *= Math.sqrt(scale);
    ry *= Math.sqrt(scale);
  }
  const denominator = rx * rx * midY * midY + ry * ry * midX * midX;
  const numerator = rx * rx * ry * ry - denominator;
  const factor =
    (largeArc !== sweep ? 1 : -1) *
    Math.sqrt(Math.max(0, numerator / denominator));
  const centerX = (factor * (rx * midY)) / ry + (startX + endX) / 2;
  const centerY = (-factor * (ry * midX)) / rx + (startY + endY) / 2;
  const startAngle = Math.atan2(
    (startY - centerY) / ry,
    (startX - centerX) / rx,
  );
  const endAngle = Math.atan2((endY - centerY) / ry, (endX - centerX) / rx);
  let swingAngle = endAngle - startAngle;
  if (sweep && swingAngle < 0) swingAngle += 2 * Math.PI;
  if (!sweep && swingAngle > 0) swingAngle -= 2 * Math.PI;

  const toDegrees = (radians: number) => (radians * 180) / Math.PI;
  return {
    ...point,
    curve: {
      type: "arc",
      wR: pxToIn(rx, dims),
      hR: pxToInY(ry, dims),
      // pptxgenjs subtracts a full turn from anything over 360 before scaling
      // to 60000ths of a degree, so the start angle has to arrive inside one.
      stAng: (toDegrees(startAngle) + 360) % 360,
      swAng: toDegrees(swingAngle),
    },
  };
}

/**
 * `clip-path: polygon(x y, ...)` traced as pptxgenjs custom-geometry points,
 * in inches relative to the shape's own box.
 */
function clipPathPolygonPoints(
  polygon: string,
  size: { w: number; h: number },
  dims: SlideDims,
): NonNullable<ShapeElement["points"]> | undefined {
  const points: Array<{ x: number; y: number }> = [];
  for (const pair of polygon.split(",")) {
    const [rawX, rawY] = pair.trim().split(/\s+/);
    const x = clipPathCoord(rawX, size.w, dims, pxToIn);
    const y = clipPathCoord(rawY, size.h, dims, pxToInY);
    if (x == null || y == null) return undefined;
    points.push({ x, y });
  }
  return points.length >= 3 ? [...points, { close: true }] : undefined;
}

function clipPathCoord(
  raw: string | undefined,
  side: number,
  dims: SlideDims,
  toInches: (px: number, dims: SlideDims) => number,
): number | undefined {
  if (!raw) return undefined;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return undefined;
  return raw.endsWith("%") ? (value / 100) * side : toInches(value, dims);
}

function importedTextRuns(html: string, dims: SlideDims): TextRunElement[] {
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(
    (match) => match[1],
  );
  const blocks = paragraphs.length > 0 ? paragraphs : [html];
  const runs: TextRunElement[] = [];
  blocks.forEach((block, paragraphIndex) => {
    if (paragraphIndex > 0) runs.push({ text: "\n", options: {} });
    const spans = [...block.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi)];
    if (spans.length === 0) {
      const text = decodeHtmlText(stripTags(block));
      if (text) runs.push({ text, options: {} });
      return;
    }
    for (const span of spans) {
      const attrs = span[1];
      const style = getAttribute(attrs, "style") ?? "";
      const text = decodeHtmlText(stripTags(span[2]));
      if (!text) continue;
      runs.push({ text, options: importedRunOptions(style, dims) });
    }
  });
  return runs;
}

/**
 * No table-level `border` or `margin`: pptxgenjs cascades every table option
 * onto each cell that declares none of its own, so the white rule and the flat
 * 0.04in padding this used to pass were stamped on every cell of every
 * imported table — a grid the source never drew, over the cell margins it did.
 * Both now travel per cell, from that cell's own CSS.
 */
export function tableOptions(table: TableElement): PptxGenJS.TableProps {
  return {
    x: table.x,
    y: table.y,
    w: table.w,
    h: table.h,
    ...(table.colW ? { colW: table.colW } : {}),
    ...(table.rowH ? { rowH: table.rowH } : {}),
    autoPage: false,
  };
}

/** Inline style of the first `<p>` in a fragment, which is where the importer puts paragraph-level alignment. */
function firstParagraphStyle(html: string): string | undefined {
  return html.match(/<p\b[^>]*style=["']([^"']*)["']/i)?.[1];
}

/**
 * The `<colgroup>` and `<tr>` percentages the importer derives from
 * `a:tblGrid/a:gridCol` and `a:tr/@h`, back as the inch sizes `addTable`
 * needs. Without them pptxgenjs divides the box evenly, so a table exports
 * with columns and rows the source never had — nine equal columns in place of
 * gamesfund's 1001175/836125/862000/899775... grid.
 *
 * A track list that does not cover every column (pptxgenjs counts colspans) or
 * every row is dropped whole: a partial `colW` makes pptxgenjs warn and fall
 * back anyway, and a partial `rowH` would size some rows from the source and
 * the rest from the box.
 */
function importedTableTracks(
  html: string,
  rows: TableRow[],
  box: { w: number; h: number },
): { colW?: number[]; rowH?: number[] } {
  const percentages = (pattern: RegExp) => {
    const values = [...html.matchAll(pattern)].map((match) =>
      Number.parseFloat(match[1]),
    );
    return values.every((value) => Number.isFinite(value) && value > 0)
      ? values
      : [];
  };
  const columnCount = (rows[0] ?? []).reduce(
    (total, cell) => total + (Number(cell.options?.colspan) || 1),
    0,
  );
  const colW = percentages(
    /<col\b[^>]*\bstyle=["'][^"']*\bwidth\s*:\s*([\d.]+)%/gi,
  );
  const rowH = percentages(
    /<tr\b[^>]*\bstyle=["'][^"']*\bheight\s*:\s*([\d.]+)%/gi,
  );
  return {
    ...(colW.length === columnCount
      ? { colW: colW.map((percent) => (percent / 100) * box.w) }
      : {}),
    ...(rowH.length === rows.length
      ? { rowH: rowH.map((percent) => (percent / 100) * box.h) }
      : {}),
  };
}

/**
 * A cell's CSS `padding` as pptxgenjs's `[top, right, bottom, left]` margin.
 * The library reads any side >= 1 as points rather than inches, so a padding
 * that large is left to its default instead of exporting an inch as a point.
 */
function importedCellMargin(
  style: string,
  dims: SlideDims,
): [number, number, number, number] | undefined {
  const parts = getStyle(style, "padding")
    ?.trim()
    .split(/\s+/)
    .map((value) => Number.parseFloat(value));
  if (!parts?.length || parts.length > 4) return undefined;
  if (parts.some((value) => !Number.isFinite(value) || value < 0))
    return undefined;
  const [top, right = top, bottom = top, left = right] = parts;
  const margin: [number, number, number, number] = [
    pxToInY(top, dims),
    pxToIn(right, dims),
    pxToInY(bottom, dims),
    pxToIn(left, dims),
  ];
  return margin.some((inches) => inches >= 1) ? undefined : margin;
}

function importedTableRows(html: string, dims: SlideDims): TableRow[] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(
    (rowMatch): TableRow =>
      [...rowMatch[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)].map(
        (cellMatch): TableCell => {
          const attrs = cellMatch[1];
          const cellHtml = cellMatch[2];
          const style = getAttribute(attrs, "style") ?? "";
          const runs = importedTextRuns(cellHtml, dims);
          const parsedFill = cssFillToSolid(
            getStyle(style, "background(?:-color)?"),
          );
          const border = parseCssBorder(getStyle(style, "border"));
          const parsedBorder = border ? colorToHex(border.color) : undefined;
          const colSpan = Number.parseInt(
            getAttribute(attrs, "colspan") ?? "",
            10,
          );
          const rowSpan = Number.parseInt(
            getAttribute(attrs, "rowspan") ?? "",
            10,
          );
          // The importer writes the cell's alignment on the paragraph, not the
          // `<td>`; reading only the cell style exported every imported table
          // left-aligned regardless of what the source `a:pPr algn` said.
          const align =
            getStyle(style, "text-align") ??
            getStyle(firstParagraphStyle(cellHtml) ?? "", "text-align");
          const verticalAlign = getStyle(style, "vertical-align");
          const margin = importedCellMargin(style, dims);
          const options: NonNullable<TableCell["options"]> = {
            ...(margin ? { margin } : {}),
            ...(align === "center" || align === "right" || align === "justify"
              ? { align }
              : {}),
            ...(verticalAlign === "top" ||
            verticalAlign === "middle" ||
            verticalAlign === "bottom"
              ? { valign: verticalAlign }
              : {}),
            ...(parsedFill
              ? {
                  fill: {
                    color: parsedFill.hex,
                    ...(parsedFill.transparency != null
                      ? { transparency: parsedFill.transparency }
                      : {}),
                  },
                }
              : {}),
            ...(parsedBorder && border
              ? {
                  border: {
                    // pptxgenjs table borders only offer solid or dash, so a
                    // dotted rule maps to the nearest broken stroke.
                    type: border.dashType
                      ? ("dash" as const)
                      : ("solid" as const),
                    color: parsedBorder.hex,
                    pt: Math.max(0.5, pxToPt(border.widthPx, dims)),
                  },
                }
              : {}),
            ...(Number.isFinite(colSpan) && colSpan > 1
              ? { colspan: colSpan }
              : {}),
            ...(Number.isFinite(rowSpan) && rowSpan > 1
              ? { rowspan: rowSpan }
              : {}),
          };
          const text: TableCell["text"] =
            runs.length > 0
              ? runs.map((run) => ({ text: run.text, options: run.options }))
              : "";
          return { text, options };
        },
      ),
  );
}

function importedRunOptions(
  style: string,
  dims: SlideDims,
): TextRunElement["options"] {
  const fontSizePx = cssPx(style, "font-size");
  const fontFamily = cssFontFace(style);
  const fontWeight = getStyle(style, "font-weight");
  const colorValue = getStyle(style, "color");
  const parsedColor = colorValue
    ? colorToHex(colorValue) // guard:allow-raw-color - PPTX text fallback
    : undefined;
  return {
    ...(fontSizePx != null ? { fontSize: pxToPt(fontSizePx, dims) } : {}),
    ...(fontFamily ? { fontFace: fontFamily } : {}),
    ...(parsedColor
      ? { color: parsedColor.hex, transparency: parsedColor.transparency }
      : {}),
    ...(fontWeight
      ? {
          bold: Number.parseInt(fontWeight, 10) >= 700 || fontWeight === "bold",
        }
      : {}),
    ...(getStyle(style, "font-style") === "italic" ? { italic: true } : {}),
    ...(getStyle(style, "text-decoration")?.includes("underline")
      ? { underline: { style: "sng" as const } }
      : {}),
  };
}

function cssPx(style: string, property: string): number | null {
  const value = getStyle(style, property);
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getAttribute(attrs: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attrs.match(
    new RegExp(`\\b${escapedName}\\s*=\\s*(["'])(.*?)\\1`, "i"),
  );
  return match?.[2] ?? null;
}

function stripTags(value: string): string {
  return value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, "");
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&#x25cf;/gi, "●");
}

/** Split a CSS function argument list on top-level commas — an rgb/rgba stop carries its own. */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** `<a:srgbClr>` carrying the alpha an rgba or 8-digit-hex value declares. */
function drawingMlColor(parsed: {
  hex: string;
  transparency?: number;
}): string {
  return parsed.transparency
    ? `<a:srgbClr val="${parsed.hex}"><a:alpha val="${Math.round((100 - parsed.transparency) * 1000)}"/></a:srgbClr>`
    : `<a:srgbClr val="${parsed.hex}"/>`;
}

/**
 * The inverse of the importer's `parseGradientFill` (packages/core
 * `ingestion/pptx.ts`): CSS measures a linear angle clockwise from "up",
 * OOXML's `<a:lin ang>` clockwise from the positive x-axis, so the two differ
 * by 90°, and `<a:fillToRect>`'s edge insets collapse to the radial focus.
 *
 * Returns `undefined` for a gradient it cannot express (`conic`, an angle unit
 * other than `deg`, a single stop) so the caller keeps the flattened solid fill
 * instead of writing a background PowerPoint rejects.
 */
export function cssGradientToDrawingMl(css: string): string | undefined {
  const match = css.trim().match(/^(linear|radial)-gradient\(([\s\S]*)\)$/i);
  if (!match) return undefined;
  const kind = match[1].toLowerCase();
  const args = splitTopLevel(match[2]);

  // A gradient's first argument is either its configuration (`45deg`,
  // `to right`, `circle at 20% 30%`) or already the first color stop, and one
  // thing tells them apart: a stop starts with a color. Recognizing only the
  // configuration spellings we had handled let every other one — `to right`, a
  // bare `circle` — fall through to `colorToHex`, which turned a direction
  // keyword into a white stop the source never had.
  const config =
    args.length > 0 && !parseCssColor(splitGradientStop(args[0]).color)
      ? args[0]
      : undefined;
  const stopArgs = config === undefined ? args : args.slice(1);
  if (stopArgs.length < 2) return undefined;

  let geometry: string;
  if (kind === "linear") {
    const cssAngle = linearGradientAngle(config);
    if (cssAngle === undefined) return undefined;
    const ang = Math.round(((((cssAngle - 90) % 360) + 360) % 360) * 60000);
    geometry = `<a:lin ang="${ang}" scaled="0"/>`;
  } else {
    const center = radialGradientCenter(config);
    if (!center) return undefined;
    const pct = (value: number) => Math.round(value * 1000);
    geometry = `<a:path path="circle"><a:fillToRect l="${pct(center.x)}" t="${pct(center.y)}" r="${pct(100 - center.x)}" b="${pct(100 - center.y)}"/></a:path>`;
  }

  const stops: string[] = [];
  for (const [index, stopArg] of stopArgs.entries()) {
    const { color, position } = splitGradientStop(stopArg);
    const parsed = parseCssColor(color);
    if (!parsed) return undefined;
    const resolved = position ?? (index / (stopArgs.length - 1)) * 100;
    const clamped = Math.min(100, Math.max(0, resolved));
    stops.push(
      `<a:gs pos="${Math.round(clamped * 1000)}">${drawingMlColor(parsed)}</a:gs>`,
    );
  }
  return `<a:gradFill rotWithShape="1"><a:gsLst>${stops.join("")}</a:gsLst>${geometry}</a:gradFill>`;
}

/** Split a gradient stop into its color token and optional position. */
function splitGradientStop(arg: string): { color: string; position?: number } {
  const match = arg.match(/\s([\d.]+)%$/);
  return match
    ? { color: arg.slice(0, match.index).trim(), position: Number(match[1]) }
    : { color: arg };
}

/**
 * CSS `to <side-or-corner>` as its angle. A corner's true angle depends on the
 * box's aspect ratio, but `<a:lin scaled="0">` takes an absolute one, so the
 * 45° diagonals are the closest fixed stand-in.
 */
const LINEAR_GRADIENT_SIDE_ANGLES: Record<string, number> = {
  top: 0,
  "top right": 45,
  "right top": 45,
  right: 90,
  "bottom right": 135,
  "right bottom": 135,
  bottom: 180,
  "bottom left": 225,
  "left bottom": 225,
  left: 270,
  "top left": 315,
  "left top": 315,
};

/** The CSS angle a `linear-gradient` configuration argument names, or `undefined` when it names one we cannot express. */
function linearGradientAngle(config: string | undefined): number | undefined {
  if (config === undefined) return 180; // CSS defaults to `to bottom`
  const degrees = config.match(/^(-?[\d.]+)deg$/i)?.[1];
  if (degrees !== undefined) return Number(degrees);
  const side = config.match(/^to\s+([a-z]+(?:\s+[a-z]+)?)$/i)?.[1];
  return side === undefined
    ? undefined
    : LINEAR_GRADIENT_SIDE_ANGLES[side.toLowerCase().replace(/\s+/g, " ")];
}

/** CSS position keywords as a percentage along their own axis. */
const RADIAL_POSITION_PERCENTS: Record<string, number> = {
  left: 0,
  top: 0,
  center: 50,
  right: 100,
  bottom: 100,
};

/** The focus a `radial-gradient` configuration argument names, or `undefined` when it names one we cannot express. */
function radialGradientCenter(
  config: string | undefined,
): { x: number; y: number } | undefined {
  if (config === undefined) return { x: 50, y: 50 };
  const at = config.match(/\bat\s+(.+)$/i)?.[1].trim();
  if (at === undefined) return { x: 50, y: 50 };
  const axes = at.split(/\s+/).map((axis) => {
    const percent = axis.match(/^([\d.]+)%$/)?.[1];
    return percent !== undefined
      ? Number(percent)
      : RADIAL_POSITION_PERCENTS[axis.toLowerCase()];
  });
  // A lone value positions the x axis and centers the y axis.
  const [x, y = 50] = axes;
  if (axes.length > 2 || x === undefined || y === undefined) return undefined;
  return { x, y };
}

/** `<a:clrScheme>` requires every slot, in this order. */
const THEME_COLOR_SLOTS = [
  "dk1",
  "lt1",
  "dk2",
  "lt2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink",
] as const;

/** The deck's own palette as a `<a:clrScheme>`, or `undefined` when a slot is missing. */
export function themeClrSchemeXml(
  colorsByName: Record<string, string>,
): string | undefined {
  const slots: string[] = [];
  for (const slot of THEME_COLOR_SLOTS) {
    const color = colorsByName[slot];
    if (!color) return undefined;
    slots.push(`<a:${slot}>${drawingMlColor(colorToHex(color))}</a:${slot}>`);
  }
  return `<a:clrScheme name="Deck">${slots.join("")}</a:clrScheme>`;
}

function replaceOnce(
  xml: string,
  pattern: RegExp,
  replacement: string,
  what: string,
): string {
  if (!pattern.test(xml)) {
    throw new Error(
      `[export-pptx] could not rewrite ${what}: pptxgenjs no longer emits the node this patches. Nothing was written rather than shipping a deck that silently lost it.`,
    );
  }
  return xml.replace(pattern, () => replacement);
}

/**
 * Rewrite the two parts pptxgenjs hardcodes. `ShapeFillProps.type` is only
 * `'none' | 'solid'` and `makeXmlTheme` templates a fixed Office `clrScheme`,
 * so a deck's theme palette and its gradient slide backgrounds cannot be
 * expressed through the API at all; they have to be patched into the finished
 * package. Shape-level gradients stay flattened — unlike `<p:bg>` there is no
 * stable node to address per shape, so that one really is the library ceiling.
 */
export async function applyDeckIdentity(
  buffer: Buffer,
  args: {
    themeColors?: Record<string, string>;
    /** 0-based slide index -> `<a:gradFill>` XML. */
    slideGradients: Map<number, string>;
  },
): Promise<Buffer> {
  const clrScheme = args.themeColors
    ? themeClrSchemeXml(args.themeColors)
    : undefined;
  if (!clrScheme && args.slideGradients.size === 0) return buffer;

  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const rewrite = async (
    partPath: string,
    pattern: RegExp,
    replacement: string,
    what: string,
  ) => {
    const xml = await zip.file(partPath)?.async("string");
    if (xml === undefined) {
      throw new Error(`[export-pptx] generated package is missing ${partPath}`);
    }
    zip.file(partPath, replaceOnce(xml, pattern, replacement, what));
  };

  if (clrScheme) {
    await rewrite(
      "ppt/theme/theme1.xml",
      /<a:clrScheme name="[^"]*">[\s\S]*?<\/a:clrScheme>/,
      clrScheme,
      "the theme color scheme",
    );
  }
  for (const [slideIndex, gradFill] of args.slideGradients) {
    await rewrite(
      `ppt/slides/slide${slideIndex + 1}.xml`,
      /<p:bg>[\s\S]*?<\/p:bg>/,
      `<p:bg><p:bgPr>${gradFill}<a:effectLst/></p:bgPr></p:bg>`,
      `slide ${slideIndex + 1}'s gradient background`,
    );
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/**
 * Fetch a URL and return it as a base64 data URI.
 *
 * Hand-rolled SSRF allow-list checks have repeatedly missed cases (Alibaba
 * cloud-metadata, IPv6 IMDS, decimal/octal IPv4, DNS rebinding, etc.).
 * Route every URL through the central `ssrfSafeFetch` helper, which validates
 * DNS and every redirect hop. Also enforce that the response is actually an
 * image so a 200 OK from an internal HTML / JSON endpoint can't smuggle bytes
 * into the .pptx.
 */
export async function fetchImageAsBase64(
  url: string,
  ownerEmail?: string,
): Promise<string | null> {
  try {
    const parsedUrl = new URL(url, "http://slides.local");
    if (parsedUrl.pathname.startsWith("/api/import-assets/") && ownerEmail) {
      const token = parsedUrl.pathname.slice("/api/import-assets/".length);
      const localAsset = await readLocalImportedAsset({
        token,
        email: ownerEmail,
      });
      if (localAsset) {
        return `data:${localAsset.mimeType};base64,${Buffer.from(localAsset.data).toString("base64")}`;
      }
      return null;
    }
    const response = await ssrfSafeFetch(
      url,
      { signal: AbortSignal.timeout(10_000) },
      { maxRedirects: 3 },
    );
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      return null;
    }
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

export default defineAction({
  description:
    "Export a deck as a PowerPoint (.pptx) file, preserving imported PPTX geometry, text styles, shapes, and images. Freeform editor objects must use the Slides editor's Export > PowerPoint flow so browser-rendered geometry is preserved. Returns a download URL for the generated file.",
  schema: z.object({
    deckId: z.string().describe("Deck ID to export"),
    includeNotes: z
      .preprocess(
        (v) => (v === "true" ? true : v === "false" ? false : v),
        z.boolean().optional().default(true),
      )
      .describe("Include speaker notes"),
  }),
  run: async ({ deckId, includeNotes }) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("no authenticated user");

    const access = await resolveAccess("deck", deckId);
    if (!access) throw new Error(`Deck not found: ${deckId}`);

    const row = access.resource;
    const deckData = JSON.parse(row.data);
    const slides = deckData.slides || [];
    const rawAspectRatio = deckData.aspectRatio;
    const aspectRatio: AspectRatio | undefined = ASPECT_RATIO_VALUES.includes(
      rawAspectRatio,
    )
      ? rawAspectRatio
      : undefined;
    // `<p:sldSz>` is per presentation, so the first slide that declares a
    // source page size settles it for the whole export; `parseSlideHtml`
    // re-derives the same value per slide.
    const slideContents: string[] = slides.map((slide: unknown) =>
      slide &&
      typeof slide === "object" &&
      typeof (slide as { content?: unknown }).content === "string"
        ? (slide as { content: string }).content
        : "",
    );
    const sourcePage = slideContents
      .map(sourcePageInches)
      .find((page) => page !== undefined);
    const dims: SlideDims = {
      ...getAspectRatioDims(aspectRatio),
      ...(sourcePage ? { pptxInches: sourcePage } : {}),
    };

    const PptxGenJS = (await import("pptxgenjs")).default;
    const pptx = new PptxGenJS();

    if (
      Math.abs(dims.pptxInches.w - 13.33) < 0.01 &&
      Math.abs(dims.pptxInches.h - 7.5) < 0.01
    ) {
      pptx.layout = "LAYOUT_WIDE"; // built-in 16:9
    } else {
      pptx.defineLayout({
        name: "AGENT_NATIVE",
        width: dims.pptxInches.w,
        height: dims.pptxInches.h,
      });
      pptx.layout = "AGENT_NATIVE";
    }
    pptx.author = "Agent Native Slides";
    pptx.title = row.title;
    // The font scheme is the one half of the theme pptxgenjs does expose;
    // without it a themed deck re-imports as Calibri Light / Calibri.
    const [headFontFace, bodyFontFace] = deckThemeFonts(deckData);
    if (headFontFace) pptx.theme = { headFontFace, bodyFontFace };

    const slideGradients = new Map<number, string>();
    let backgroundGradientsFlattened = 0;

    for (const [slideIndex, slide] of slides.entries()) {
      const pptxSlide = pptx.addSlide();
      const slideContent = slideContents[slideIndex];
      const {
        texts,
        images,
        shapes,
        tables,
        grid,
        bgColor,
        bgTransparency,
        bgGradient,
      } = parseSlideHtml(slideContent, aspectRatio, slideIndex + 1);

      // The solid fill stays the pre-rewrite value: `applyDeckIdentity`
      // replaces the whole `<p:bg>` when the gradient survives, and this is
      // what the deck falls back to when it does not.
      pptxSlide.background = {
        color: bgColor,
        ...(bgTransparency != null ? { transparency: bgTransparency } : {}),
      };
      if (bgGradient) {
        const gradFill = cssGradientToDrawingMl(bgGradient);
        if (gradFill) {
          slideGradients.set(slideIndex, gradFill);
        } else {
          backgroundGradientsFlattened++;
          console.warn(
            `[export-pptx] slide ${slideIndex + 1} background "${bgGradient}" has no DrawingML equivalent; exported as flat #${bgColor}`,
          );
        }
      }

      if (grid) {
        const gridWidth = pxToIn(grid.stepX, dims);
        const gridHeight = pxToInY(grid.stepY, dims);
        const gridX = pxToIn(grid.offsetX, dims);
        const gridY = pxToInY(grid.offsetY, dims);
        const lineWidth = Math.max(0.5, grid.lineWidth * 0.75);
        const gridLine = {
          color: grid.color,
          width: lineWidth,
          ...(grid.transparency != null
            ? { transparency: grid.transparency }
            : {}),
        };

        for (let x = gridX; x < dims.pptxInches.w; x += gridWidth) {
          pptxSlide.addShape(pptx.ShapeType.line, {
            x,
            y: 0,
            w: 0,
            h: dims.pptxInches.h,
            line: gridLine,
          });
        }
        for (let y = gridY; y < dims.pptxInches.h; y += gridHeight) {
          pptxSlide.addShape(pptx.ShapeType.line, {
            x: 0,
            y,
            w: dims.pptxInches.w,
            h: 0,
            line: gridLine,
          });
        }
      }

      const orderedTexts = [...texts].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0),
      );
      const orderedImages = [...images].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0),
      );
      const orderedShapes = [...shapes].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0),
      );
      const orderedTables = [...tables].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0),
      );

      // Imported elements are parsed separately because PptxGenJS needs real
      // slide objects. Keep their source order so overlapping objects retain
      // the same paint order as the editor preview.
      const orderedObjects = [
        ...orderedTexts.map((value) => ({ kind: "text" as const, value })),
        ...orderedImages.map((value) => ({ kind: "image" as const, value })),
        ...orderedShapes.map((value) => ({ kind: "shape" as const, value })),
        ...orderedTables.map((value) => ({ kind: "table" as const, value })),
      ].sort((a, b) => (a.value.order ?? 0) - (b.value.order ?? 0));

      for (const object of orderedObjects) {
        if (object.kind === "text") {
          const t = object.value;
          const options = {
            x: t.x,
            y: t.y,
            w: t.w,
            h: t.h,
            color: t.color,
            bold: t.bold,
            align: t.align || "left",
            valign: "top" as const,
            wrap: true,
            ...(t.fontSize != null ? { fontSize: t.fontSize } : {}),
            ...(t.fontFace != null ? { fontFace: t.fontFace } : {}),
            ...(t.transparency != null ? { transparency: t.transparency } : {}),
            ...(t.letterSpacing != null
              ? { charSpacing: t.letterSpacing }
              : {}),
            ...(t.lineSpacingMultiple != null
              ? { lineSpacingMultiple: t.lineSpacingMultiple }
              : {}),
            ...(t.rotate != null ? { rotate: t.rotate } : {}),
          };
          if (t.runs?.length) {
            pptxSlide.addText(t.runs, options);
          } else {
            pptxSlide.addText(t.text, options);
          }
        } else if (object.kind === "image") {
          const img = object.value;
          const dataUri = await fetchImageAsBase64(img.src, userEmail);
          if (dataUri) {
            pptxSlide.addImage({
              data: dataUri,
              x: img.x,
              y: img.y,
              w: img.w,
              h: img.h,
              ...(img.rotate != null ? { rotate: img.rotate } : {}),
            });
          }
        } else if (object.kind === "table") {
          pptxSlide.addTable(object.value.rows, tableOptions(object.value));
        } else {
          const shape = object.value;
          pptxSlide.addShape(
            resolveShapeType(pptx.ShapeType, shape.shapeType),
            {
              x: shape.x,
              y: shape.y,
              w: shape.w,
              h: shape.h,
              ...(shape.rectRadius != null
                ? { rectRadius: shape.rectRadius }
                : {}),
              ...(shape.rotate != null ? { rotate: shape.rotate } : {}),
              ...(shape.points ? { points: shape.points } : {}),
              ...(shape.fill
                ? {
                    fill: {
                      color: shape.fill,
                      ...(shape.fillTransparency != null
                        ? { transparency: shape.fillTransparency }
                        : {}),
                    },
                  }
                : {}),
              ...(shape.lineColor
                ? {
                    line: {
                      color: shape.lineColor,
                      width: shape.lineWidth ?? 1,
                      ...(shape.lineDashType
                        ? { dashType: shape.lineDashType }
                        : {}),
                      ...(shape.lineHeadType
                        ? { beginArrowType: shape.lineHeadType }
                        : {}),
                      ...(shape.lineTailType
                        ? { endArrowType: shape.lineTailType }
                        : {}),
                      ...(shape.lineTransparency != null
                        ? { transparency: shape.lineTransparency }
                        : {}),
                    },
                  }
                : {}),
            },
          );
        }
      }

      // Add speaker notes
      if (
        includeNotes &&
        slide &&
        typeof slide.notes === "string" &&
        slide.notes
      ) {
        pptxSlide.addNotes(slide.notes);
      }
    }

    const buffer = await applyDeckIdentity(
      (await pptx.write({ outputType: "nodebuffer" })) as Buffer,
      { themeColors: deckThemeColors(deckData), slideGradients },
    );
    const filename = safeGeneratedFilename(row.title, ".pptx");

    // Disk write is only useful when the same process can later serve the
    // file. On serverless (Netlify / Vercel / Lambda), the function filesystem
    // vanishes between invocations, so `/api/exports/:filename` requests land
    // on a different container that doesn't have the file — the user sees
    // "file doesn't exist on site". Skip the disk write entirely on those
    // hosts; the route handler streams `buffer` directly. CLI and local-dev
    // still get a real file path.
    let filePath: string | undefined;
    if (!isServerless()) {
      const exportDir = tenantExportDir(userEmail);
      fs.mkdirSync(exportDir, { recursive: true });
      filePath = path.join(exportDir, filename);
      fs.writeFileSync(filePath, buffer);
    }

    return {
      buffer,
      filePath,
      filename,
      slideCount: slides.length,
      ...(backgroundGradientsFlattened > 0
        ? { backgroundGradientsFlattened }
        : {}),
    };
  },
});

/**
 * The palette an imported deck kept from its source `<a:clrScheme>`, in the
 * shape `import-pptx` already returns. Absent on decks imported before the
 * importer persisted it, and on decks the editor authored — both export with
 * pptxgenjs's Office default, which is the honest answer for a deck that has
 * no theme of its own.
 */
function deckThemeColors(
  deckData: unknown,
): Record<string, string> | undefined {
  const colorsByName = (
    deckData as { theme?: { colorsByName?: unknown } } | null
  )?.theme?.colorsByName;
  if (!colorsByName || typeof colorsByName !== "object") return undefined;
  const entries = Object.entries(colorsByName).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** `[majorFont, minorFont]` from the deck's theme, in `parseTheme`'s own order. */
function deckThemeFonts(
  deckData: unknown,
): [string | undefined, string | undefined] {
  const fonts = (deckData as { theme?: { fonts?: unknown } } | null)?.theme
    ?.fonts;
  if (!Array.isArray(fonts)) return [undefined, undefined];
  const face = (index: number) =>
    typeof fonts[index] === "string" && fonts[index]
      ? (fonts[index] as string)
      : undefined;
  return [face(0), face(1) ?? face(0)];
}

function isServerless(): boolean {
  return Boolean(
    process.env.NETLIFY ||
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.cwd() === "/var/task" ||
    process.cwd().startsWith("/var/task/"),
  );
}
