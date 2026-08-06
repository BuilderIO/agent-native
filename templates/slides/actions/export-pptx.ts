import fs from "fs";
import path from "path";

import { defineAction } from "@agent-native/core";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
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

/**
 * Extract inline style value for a given property from a style string.
 */
function getStyle(style: string, prop: string): string | null {
  const re = new RegExp(`${prop}\\s*:\\s*([^;]+)`, "i");
  const m = style.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Convert a CSS color string to a 6-char hex string (no #).
 * Handles #hex, #shortHex, rgb(), rgba(), and named colors.
 */
function colorToHex(color: string): string {
  if (!color) return "FFFFFF";

  // Strip quotes / trim
  color = color.replace(/['"]/g, "").trim();

  // Already hex
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.slice(1).toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const r = color[1],
      g = color[2],
      b = color[3];
    return `${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  // rgb / rgba
  const rgbMatch = color.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)/,
  );
  if (rgbMatch) {
    const hex = (n: string) => parseInt(n).toString(16).padStart(2, "0");
    return `${hex(rgbMatch[1])}${hex(rgbMatch[2])}${hex(rgbMatch[3])}`.toUpperCase();
  }

  // Common named colors used in the slide templates
  const named: Record<string, string> = {
    white: "FFFFFF",
    black: "000000",
    transparent: "000000",
  };
  if (named[color.toLowerCase()]) return named[color.toLowerCase()];

  return "FFFFFF";
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
 * Convert CSS font-size px to PowerPoint points.
 * 1px CSS ≈ 0.75pt.
 */
function pxToPt(px: number): number {
  return Math.round(px * 0.75);
}

interface TextElement {
  text: string;
  fontSize: number; // in pt
  fontFace: string;
  color: string; // 6-char hex
  bold: boolean;
  x: number; // inches
  y: number; // inches
  w: number; // inches
  h: number; // inches
  align?: "left" | "center" | "right";
  letterSpacing?: number;
  lineSpacing?: number;
  runs?: TextRunElement[];
  order?: number;
}

interface TextRunElement {
  text: string;
  options: {
    fontSize?: number;
    fontFace?: string;
    color?: string;
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
  order?: number;
}

interface ShapeElement {
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  lineColor?: string;
  lineWidth?: number;
  rounded?: boolean;
  order?: number;
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

/**
 * Parse slide HTML and extract text/image elements with positioning.
 * We know the exact HTML structure from the slide templates.
 */
export function parseSlideHtml(
  html: string,
  aspectRatio?: AspectRatio,
  slideNumber = 1,
): {
  texts: TextElement[];
  images: ImageElement[];
  shapes: ShapeElement[];
  bgColor: string;
} {
  assertServerPptxExportable(html, slideNumber);
  const dims = getAspectRatioDims(aspectRatio);
  if (html.includes('data-imported-pptx="true"')) {
    return parseImportedSlideHtml(html, dims);
  }

  const texts: TextElement[] = [];
  const images: ImageElement[] = [];
  const shapes: ShapeElement[] = [];
  let bgColor = "000000";

  const slideW = dims.pptxInches.w;
  const slideH = dims.pptxInches.h;

  // Check for background color on the outer .fmd-slide div
  const slideStyleMatch = html.match(/class="fmd-slide"[^>]*style="([^"]*)"/);
  if (slideStyleMatch) {
    const bg = getStyle(slideStyleMatch[1], "background(?:-color)?");
    if (bg) bgColor = colorToHex(bg);
  }

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

      texts.push({
        text,
        fontSize: pxToPt(fontSize),
        fontFace: "Poppins",
        color: colorToHex(color),
        bold,
        x: xMargin,
        y: yPos,
        w: contentW,
        h: elHeight + 0.2,
        letterSpacing: letterSpacing ? parseFloat(letterSpacing) : undefined,
        lineSpacing: lineH ? Math.round(lineH * pxToPt(fontSize)) : undefined,
      });

      yPos += elHeight + pxToIn(marginBottom, dims) + 0.1;
    }
  }

  return { texts, images, shapes, bgColor };
}

type SlideDims = ReturnType<typeof getAspectRatioDims>;

function parseImportedSlideHtml(
  html: string,
  dims: SlideDims,
): {
  texts: TextElement[];
  images: ImageElement[];
  shapes: ShapeElement[];
  bgColor: string;
} {
  const texts: TextElement[] = [];
  const images: ImageElement[] = [];
  const shapes: ShapeElement[] = [];
  const outerStyle = html.match(
    /class=["'][^"']*\bfmd-slide\b[^"']*["'][^>]*style=["']([^"']*)["']/i,
  )?.[1];
  const bgColor = colorToHex(
    outerStyle
      ? (getStyle(outerStyle, "background(?:-color)?") ?? "#000000")
      : "#000000",
  );
  const elementRegex =
    /<div\b([^>]*\bdata-pptx-element-kind=["'](text|image|shape)["'][^>]*)>([\s\S]*?)<\/div>/gi;
  let match: RegExpExecArray | null;
  while ((match = elementRegex.exec(html)) !== null) {
    const attrs = match[1];
    const kind = match[2].toLowerCase();
    const innerHtml = match[3];
    const style = getAttribute(attrs, "style") ?? "";
    const geometry = importedGeometry(style, dims);
    if (!geometry) continue;

    if (kind === "image") {
      const imageAttrs = innerHtml.match(/<img\b([^>]*)>/i)?.[1] ?? "";
      const src = getAttribute(imageAttrs, "src");
      if (src) {
        images.push({ src, ...geometry, order: match.index });
      }
      continue;
    }

    if (kind === "shape") {
      const fill = getStyle(style, "background(?:-color)?");
      const border = getStyle(style, "border");
      const borderMatch = border?.match(/([\d.]+)px\s+solid\s+(.+)/i);
      shapes.push({
        ...geometry,
        ...(fill && !fill.includes("gradient")
          ? { fill: colorToHex(fill) }
          : {}),
        ...(borderMatch
          ? {
              lineColor: colorToHex(borderMatch[2]),
              lineWidth: Number(borderMatch[1]),
            }
          : {}),
        rounded: style.includes("border-radius"),
        order: match.index,
      });
      continue;
    }

    const runs = importedTextRuns(innerHtml);
    const firstRun = runs.find((run) => run.text.trim()) ?? runs[0];
    const firstParagraph = innerHtml.match(
      /<p\b[^>]*style=["']([^"']*)["']/i,
    )?.[1];
    const lineHeight = firstParagraph
      ? getStyle(firstParagraph, "line-height")
      : null;
    const fontSize = firstRun?.options.fontSize ?? 18;
    const alignValue = getStyle(style, "text-align");
    texts.push({
      text: runs.map((run) => run.text).join(""),
      fontSize,
      fontFace: firstRun?.options.fontFace ?? "Poppins",
      color: firstRun?.options.color ?? "FFFFFF",
      bold: firstRun?.options.bold ?? false,
      align:
        alignValue === "center" || alignValue === "right" ? alignValue : "left",
      lineSpacing: lineHeight ? Number(lineHeight) * fontSize : undefined,
      x: geometry.x,
      y: geometry.y,
      w: geometry.w,
      h: geometry.h,
      runs,
      order: match.index,
    });
  }

  return { texts, images, shapes, bgColor };
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

function importedTextRuns(html: string): TextRunElement[] {
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
      runs.push({ text, options: importedRunOptions(style) });
    }
  });
  return runs;
}

function importedRunOptions(style: string): TextRunElement["options"] {
  const fontSizePx = cssPx(style, "font-size");
  const fontFamily = getStyle(style, "font-family")
    ?.replace(/["']/g, "")
    .split(",")[0]
    ?.trim();
  const fontWeight = getStyle(style, "font-weight");
  return {
    ...(fontSizePx != null ? { fontSize: pxToPt(fontSizePx) } : {}),
    ...(fontFamily ? { fontFace: fontFamily } : {}),
    ...(getStyle(style, "color")
      ? { color: colorToHex(getStyle(style, "color") ?? "#FFFFFF") }
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
    const dims = getAspectRatioDims(aspectRatio);

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

    for (const [slideIndex, slide] of slides.entries()) {
      const pptxSlide = pptx.addSlide();
      const slideContent =
        slide && typeof slide === "object" && typeof slide.content === "string"
          ? slide.content
          : "";
      const { texts, images, shapes, bgColor } = parseSlideHtml(
        slideContent,
        aspectRatio,
        slideIndex + 1,
      );

      pptxSlide.background = { color: bgColor };

      const orderedTexts = [...texts].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0),
      );
      const orderedImages = [...images].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0),
      );
      const orderedShapes = [...shapes].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0),
      );

      // Imported elements are parsed separately because PptxGenJS needs real
      // slide objects. Keep their source order so overlapping objects retain
      // the same paint order as the editor preview.
      const orderedObjects = [
        ...orderedTexts.map((value) => ({ kind: "text" as const, value })),
        ...orderedImages.map((value) => ({ kind: "image" as const, value })),
        ...orderedShapes.map((value) => ({ kind: "shape" as const, value })),
      ].sort((a, b) => (a.value.order ?? 0) - (b.value.order ?? 0));

      for (const object of orderedObjects) {
        if (object.kind === "text") {
          const t = object.value;
          const options = {
            x: t.x,
            y: t.y,
            w: t.w,
            h: t.h,
            fontSize: t.fontSize,
            fontFace: t.fontFace,
            color: t.color,
            bold: t.bold,
            align: t.align || "left",
            valign: "top" as const,
            wrap: true,
            ...(t.letterSpacing != null
              ? { charSpacing: t.letterSpacing }
              : {}),
            ...(t.lineSpacing != null
              ? { lineSpacingMultiple: t.lineSpacing / t.fontSize }
              : {}),
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
            });
          }
        } else {
          const shape = object.value;
          pptxSlide.addShape(
            shape.rounded ? pptx.ShapeType.roundRect : pptx.ShapeType.rect,
            {
              x: shape.x,
              y: shape.y,
              w: shape.w,
              h: shape.h,
              ...(shape.fill ? { fill: { color: shape.fill } } : {}),
              ...(shape.lineColor
                ? {
                    line: {
                      color: shape.lineColor,
                      width: shape.lineWidth ?? 1,
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

    const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
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

    return { buffer, filePath, filename, slideCount: slides.length };
  },
});

function isServerless(): boolean {
  return Boolean(
    process.env.NETLIFY ||
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.cwd() === "/var/task" ||
    process.cwd().startsWith("/var/task/"),
  );
}
