import { defineAction } from "@agent-native/core";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { resolveAccess } from "@agent-native/core/sharing";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { isBlockedToolUrl } from "@agent-native/core/tools/url-safety";
import "../server/db/index.js"; // ensure registerShareableResource runs
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
}

interface ImageElement {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Parse slide HTML and extract text/image elements with positioning.
 * We know the exact HTML structure from the slide templates.
 */
function parseSlideHtml(
  html: string,
  aspectRatio?: AspectRatio,
): {
  texts: TextElement[];
  images: ImageElement[];
  bgColor: string;
} {
  const texts: TextElement[] = [];
  const images: ImageElement[] = [];
  let bgColor = "000000";

  const dims = getAspectRatioDims(aspectRatio);
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

  return { texts, images, bgColor };
}

/**
 * Fetch a URL and return it as a base64 data URI.
 *
 * Hand-rolled SSRF allow-list checks have repeatedly missed cases (Alibaba
 * cloud-metadata, IPv6 IMDS, decimal/octal IPv4, DNS rebinding, etc.).
 * Route every URL through the central `isBlockedToolUrl` helper, which
 * already handles all those forms. Also enforce that the response is
 * actually an image so a 200 OK from an internal HTML / JSON endpoint
 * can't smuggle bytes into the .pptx.
 */
async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    if (isBlockedToolUrl(url)) return null;

    const response = await fetch(url);
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
    "Export a deck as a PowerPoint (.pptx) file. Returns a download URL for the generated file.",
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

    for (const slide of slides) {
      const pptxSlide = pptx.addSlide();
      const { texts, images, bgColor } = parseSlideHtml(
        slide.content || "",
        aspectRatio,
      );

      pptxSlide.background = { color: bgColor };

      // Add text elements
      for (const t of texts) {
        pptxSlide.addText(t.text, {
          x: t.x,
          y: t.y,
          w: t.w,
          h: t.h,
          fontSize: t.fontSize,
          fontFace: t.fontFace,
          color: t.color,
          bold: t.bold,
          align: t.align || "left",
          valign: "top",
          wrap: true,
          ...(t.letterSpacing != null ? { charSpacing: t.letterSpacing } : {}),
          ...(t.lineSpacing != null
            ? { lineSpacingMultiple: t.lineSpacing / t.fontSize }
            : {}),
        });
      }

      // Add images
      for (const img of images) {
        // Try to fetch and embed as base64
        const dataUri = await fetchImageAsBase64(img.src);
        if (dataUri) {
          pptxSlide.addImage({
            data: dataUri,
            x: img.x,
            y: img.y,
            w: img.w,
            h: img.h,
          });
        }
      }

      // Add speaker notes
      if (includeNotes && slide.notes) {
        pptxSlide.addNotes(slide.notes);
      }
    }

    // Write to buffer and save
    const buffer = await pptx.write({ outputType: "nodebuffer" });
    const exportDir = tenantExportDir(userEmail);
    fs.mkdirSync(exportDir, { recursive: true });
    const filename = safeGeneratedFilename(row.title, ".pptx");
    const filePath = path.join(exportDir, filename);
    fs.writeFileSync(filePath, buffer as Buffer);

    return { filePath, filename, slideCount: slides.length };
  },
});
