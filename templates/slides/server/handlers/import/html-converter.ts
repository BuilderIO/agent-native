import { ASPECT_RATIOS } from "@shared/aspect-ratios";

import type {
  ParsedElement,
  ParsedParagraph,
  ParsedSlide,
  ParsedTextRun,
} from "./pptx-parser.js";

/** Escape HTML special characters. */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render a page's embedded photo as the full-bleed slide background with the
 * page's extracted text overlaid on top. Designed PDF pages (photo
 * backgrounds, gradients, custom typography) have no reliable shape
 * structure to reconstruct, so the embedded image is reused directly — but
 * the vector/glyph text on the page is not something we can rasterize
 * reliably headless, so the extracted text is drawn as real HTML on top
 * instead of relying on the page's own (font-dependent) rendering.
 *
 * `pdf-parse`'s plain-text extraction carries no color/font metadata, so the
 * heading accent color below is a stand-in, not a recovered value — when a
 * subtitle is present (a content slide, not a title slide) it renders as a
 * centered card with a divider rule so the two text roles stay visually
 * distinct instead of collapsing into one flat paragraph.
 */
export function buildFullBleedImageSlideHtml(
  imageUrl: string,
  headingText?: string,
  subtitleText?: string,
): string {
  let overlay = "";
  if (headingText && subtitleText) {
    overlay = `\n    <div style="position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(to top, rgba(12,10,8,0.95) 0%, rgba(12,10,8,0.88) 55%, rgba(12,10,8,0.4) 82%, rgba(12,10,8,0) 100%); padding: 56px 56px 60px; text-align: center; font-family: 'Poppins', sans-serif;">
      <div style="width: 72px; height: 3px; background: #d8b26a; margin: 0 auto 20px;"></div>
      <h2 style="font-size: 30px; font-weight: 800; color: #d8b26a; line-height: 1.25; margin: 0 0 14px;">${esc(headingText)}</h2>
      <p style="font-size: 19px; font-weight: 500; color: #fff; line-height: 1.5; margin: 0;">${esc(subtitleText)}</p>
    </div>`;
  } else if (headingText) {
    overlay = `\n    <div style="position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.15) 45%, rgba(0,0,0,0) 65%);"></div>
    <div style="position: absolute; left: 0; right: 0; bottom: 0; padding: 60px 70px; font-family: 'Poppins', sans-serif;">
      <h2 style="font-size: 40px; font-weight: 900; color: #fff; line-height: 1.15; letter-spacing: -1px; margin: 0;">${esc(headingText)}</h2>
    </div>`;
  }
  return `<div class="fmd-slide" style="position: relative; width: 100%; height: 100%; overflow: hidden;">
    <img src="${esc(imageUrl)}" alt="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;" />${overlay}
</div>`;
}

/** Render a rasterized source page without changing its layout or text. */
export function buildFullPageImageSlideHtml(
  imageUrl: string,
  sourceWidth?: number,
  sourceHeight?: number,
): string {
  const sourceDimensions =
    Number.isFinite(sourceWidth) &&
    Number.isFinite(sourceHeight) &&
    sourceWidth! > 0 &&
    sourceHeight! > 0
      ? ` data-source-width="${sourceWidth}" data-source-height="${sourceHeight}"`
      : "";
  return `<div class="fmd-slide fmd-imported-pdf" data-imported-pdf="true"${sourceDimensions} style="position: relative; width: 100%; height: 100%; overflow: hidden; background: hsl(var(--background));">
    <img src="${esc(imageUrl)}" alt="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain;" />
</div>`;
}

/** Wrap text in formatting tags based on run properties. */
function formatRun(run: ParsedTextRun): string {
  let text = esc(run.content);
  if (run.color)
    text = `<span style="color: ${esc(run.color)};">${text}</span>`;
  if (run.bold) text = `<strong>${text}</strong>`;
  if (run.italic) text = `<em>${text}</em>`;
  return text;
}

const DEFAULT_IMPORT_FONT = "'Poppins', sans-serif";

/**
 * PowerPoint records a weight variant as part of the typeface name
 * ("Work Sans Medium", "Open Sans SemiBold", "Roboto Black"), which no
 * webfont registers as a CSS family — `font-family: 'Work Sans Medium'`
 * always falls back, even when Work Sans itself is loaded. The same token is
 * read as a numeric weight by `fontWeightForFamily`, so stripping it here
 * loses nothing.
 */
const FONT_WEIGHT_SUFFIX =
  /[ _-](?:ultra|extra|semi|demi)?[ _-]?(?:black|heavy|bold|medium|regular|normal|roman|book|light|thin|italic|oblique)$/i;

/** Turn an extracted PPTX theme font name into a safe CSS font-family value, falling back to the default when absent. */
function cssFontFamily(themeFont: string | undefined): string {
  if (!themeFont) return DEFAULT_IMPORT_FONT;
  const safeName = themeFont.replace(/["']/g, "").trim();
  if (!safeName) return DEFAULT_IMPORT_FONT;
  let base = safeName;
  while (FONT_WEIGHT_SUFFIX.test(base)) {
    const stripped = base.replace(FONT_WEIGHT_SUFFIX, "").trim();
    if (!stripped) break;
    base = stripped;
  }
  // The authored name stays first: a deck whose exact variant family *is*
  // installed still gets it, and a family whose real name ends in a weight
  // word ("Archivo Black") is not broken by the strip.
  return base === safeName
    ? `'${safeName}', sans-serif`
    : `'${safeName}', '${base}', sans-serif`;
}

/**
 * Group text runs into logical paragraphs.
 * In PPTX, paragraph boundaries are typically between runs with different
 * formatting blocks. We group consecutive runs and split on newlines.
 */
function groupIntoParagraphs(texts: ParsedTextRun[]): ParsedTextRun[][] {
  const paragraphs: ParsedTextRun[][] = [];
  let current: ParsedTextRun[] = [];

  for (const run of texts) {
    // Split on explicit newlines within content
    const parts = run.content.split(/\r?\n/);
    for (let i = 0; i < parts.length; i++) {
      if (i > 0 && current.length > 0) {
        paragraphs.push(current);
        current = [];
      }
      const text = parts[i].trim();
      if (text) {
        current.push({ ...run, content: text });
      }
    }
  }
  if (current.length > 0) {
    paragraphs.push(current);
  }

  return paragraphs;
}

/**
 * Determine slide layout and generate HTML. `imageUrl` is the hosted URL
 * for the slide's first embedded image (already uploaded by the caller) —
 * pass undefined when the slide has no image or the upload failed, and the
 * builders fall back to a text placeholder instead of a broken `<img>`.
 * `themeFont` is the presentation's extracted theme font, if any, so
 * imported slides keep the source deck's typeface instead of always
 * rendering in Poppins.
 */
export function convertToSlideHtml(
  slide: ParsedSlide,
  imageUrls?: string | Record<string, string>,
  themeFont?: string,
): string {
  // A slide parsed with real geometry goes through the fidelity renderer even
  // when it has zero elements: a deliberately empty divider slide (a
  // full-bleed background and nothing else) is a real state the source
  // states, and the templates below would replace it with an invented
  // "Untitled Slide" heading on a background they never apply.
  if (slide.elements) {
    return buildFidelitySlide(slide, imageUrls, themeFont);
  }

  const paragraphs = groupIntoParagraphs(slide.texts);
  const fontFamily = cssFontFamily(themeFont);

  // An embedded image always wins the layout choice — a forced title slide
  // has no room to show it, which is how imports used to silently drop
  // photos from otherwise short/title-shaped slides.
  if (slide.images.length > 0) {
    return buildImageSlide(
      paragraphs,
      slide,
      typeof imageUrls === "string" ? imageUrls : undefined,
      fontFamily,
    );
  }

  if (slide.layoutHint === "title" || paragraphs.length <= 2) {
    return buildTitleSlide(paragraphs, slide, fontFamily);
  }

  return buildContentSlide(paragraphs, slide, fontFamily);
}

const DEFAULT_SLIDE_WIDTH_EMU = 9144000;
const DEFAULT_SLIDE_HEIGHT_EMU = 5143500;
// PowerPoint's own default slide background (no `<p:bg>` declared) is white,
// not black — defaulting to black here made an undecorated slide's own
// (often dark, theme-default) text unreadable or fully invisible against a
// background the source file never actually specified.
const DEFAULT_PPTX_BACKGROUND = "#ffffff"; // guard:allow-raw-color - PPTX's own white default when no background is declared
// OOXML's own default run color when nothing in the run, the placeholder
// chain, or `<p:txStyles>` declares one. It has to be the value the file
// format states, not a readable-looking approximation: an invented near-black
// renders beside the deck's real black inside a single text box, which is
// visible as two different blacks in one paragraph.
const DEFAULT_PPTX_FOREGROUND = "#000000"; // guard:allow-raw-color - OOXML's declared default text color

/**
 * The absolute px box `toSlidePxX`/`toSlidePxY` scale positions and sizes
 * against. It must match the aspect-ratio preset the deck actually renders
 * into (`ASPECT_RATIOS`, chosen by the import actions' own
 * `nearestAspectRatio`) rather than a fixed 16:9 box: a PDF page or a custom
 * PPTX slide size is routinely portrait or square, and scaling its elements
 * against a 960x540 reference while the deck itself renders in an 864x1080
 * (or other) box stretches every element by the ratio between the two
 * boxes, most visibly squashing everything into the top fraction of a
 * taller-than-540 canvas.
 */
function referenceBoxForSlide(
  widthEmu: number,
  heightEmu: number,
): { width: number; height: number } {
  const target = widthEmu / heightEmu;
  let best: { width: number; height: number } = ASPECT_RATIOS["16:9"];
  let bestDiff = Infinity;
  for (const preset of Object.values(ASPECT_RATIOS)) {
    const diff = Math.abs(preset.width / preset.height - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = preset;
    }
  }
  return { width: best.width, height: best.height };
}

function buildFidelitySlide(
  slide: ParsedSlide,
  imageUrls: string | Record<string, string> | undefined,
  themeFont: string | undefined,
): string {
  const widthEmu = slide.widthEmu || DEFAULT_SLIDE_WIDTH_EMU;
  const heightEmu = slide.heightEmu || DEFAULT_SLIDE_HEIGHT_EMU;
  const refBox = referenceBoxForSlide(widthEmu, heightEmu);
  const background = slide.backgroundColor ?? DEFAULT_PPTX_BACKGROUND;
  const gridStyle = slide.backgroundGrid
    ? `background-image:linear-gradient(to right, ${esc(slide.backgroundGrid.color)} 0 ${Math.max(0.5, toSlidePxX(slide.backgroundGrid.lineWidthEmu, widthEmu, refBox.width))}px, transparent ${Math.max(0.5, toSlidePxX(slide.backgroundGrid.lineWidthEmu, widthEmu, refBox.width))}px),linear-gradient(to bottom, ${esc(slide.backgroundGrid.color)} 0 ${Math.max(0.5, toSlidePxY(slide.backgroundGrid.lineWidthEmu, heightEmu, refBox.height))}px, transparent ${Math.max(0.5, toSlidePxY(slide.backgroundGrid.lineWidthEmu, heightEmu, refBox.height))}px);background-size:${toSlidePxX(slide.backgroundGrid.stepXEmu, widthEmu, refBox.width)}px ${toSlidePxY(slide.backgroundGrid.stepYEmu, heightEmu, refBox.height)}px;background-position:${toSlidePxX(slide.backgroundGrid.offsetXEmu, widthEmu, refBox.width)}px ${toSlidePxY(slide.backgroundGrid.offsetYEmu, heightEmu, refBox.height)}px;background-repeat:repeat;`
    : "";
  const elements = slide.elements ?? [];
  const html = elements
    .map((element, index) =>
      buildFidelityElement(
        element,
        index,
        widthEmu,
        heightEmu,
        refBox,
        imageUrls,
        themeFont,
      ),
    )
    .join("\n");

  return `<div class="fmd-slide fmd-imported-pptx" data-imported-pptx="true" data-slide-width-emu="${widthEmu}" data-slide-height-emu="${heightEmu}" style="position: relative; width: 100%; height: 100%; overflow: hidden; background: ${esc(background)};${gridStyle} font-family: ${cssFontFamily(themeFont)};">${html}
</div>`;
}

function buildFidelityElement(
  element: ParsedElement,
  index: number,
  widthEmu: number,
  heightEmu: number,
  refBox: { width: number; height: number },
  imageUrls: string | Record<string, string> | undefined,
  themeFont: string | undefined,
): string {
  const widthPx = toSlidePxX(element.width, widthEmu, refBox.width);
  const heightPx = toSlidePxY(element.height, heightEmu, refBox.height);
  const position = `position: absolute; left: ${toSlidePxX(element.x, widthEmu, refBox.width)}px; top: ${toSlidePxY(element.y, heightEmu, refBox.height)}px; width: ${widthPx}px; height: ${heightPx}px; z-index: ${index}; box-sizing: border-box;`;
  const rotation = element.rotation
    ? ` transform: rotate(${element.rotation}deg); transform-origin: center center;`
    : "";
  const objectId = ` data-slide-object-id="${esc(element.id)}"`;

  if (element.kind === "image") {
    const url = imageUrlForElement(element, imageUrls);
    const imageStyle = imageRenderStyle(element);
    return `<div class="fmd-pptx-image" data-pptx-element-kind="image" data-pptx-image-name="${esc(element.image?.name ?? "image")}"${objectId} style="${position}${rotation} overflow: hidden;">${url ? `<img src="${esc(url)}" alt="" style="${imageStyle}" />` : `<div class="fmd-img-placeholder" style="width:100%;height:100%;">Imported image: ${esc(element.image?.name ?? "image")}</div>`}</div>`;
  }

  if (element.kind === "table") {
    return buildFidelityTable(
      element,
      widthEmu,
      refBox.width,
      themeFont,
      position,
      rotation,
      objectId,
    );
  }

  const decoration = shapeDecoration(
    element,
    widthEmu,
    refBox.width,
    widthPx,
    heightPx,
  );
  if (element.kind === "shape") {
    return `<div class="fmd-pptx-shape" data-pptx-element-kind="shape"${objectId} style="${position}${rotation}${decoration}"></div>`;
  }

  const textStyle = textBoxStyle(
    element,
    widthEmu,
    heightEmu,
    refBox,
    themeFont,
  );
  const defaultFontWeight = element.placeholderType === "title" ? 700 : 400;
  const paragraphs = (element.paragraphs ?? [])
    .map((paragraph, paragraphIndex) =>
      buildFidelityParagraph(
        paragraph,
        paragraphIndex,
        widthEmu,
        refBox.width,
        themeFont,
        defaultFontWeight,
      ),
    )
    .join("\n");
  return `<div class="fmd-pptx-text" data-pptx-element-kind="text"${objectId} style="${position}${rotation}${decoration}${textStyle}">${paragraphs}</div>`;
}

function toSlidePxX(
  valueEmu: number,
  slideWidthEmu: number,
  refWidthPx: number,
): number {
  return Math.round((valueEmu / slideWidthEmu) * refWidthPx * 1000) / 1000;
}

function toSlidePxY(
  valueEmu: number,
  slideHeightEmu: number,
  refHeightPx: number,
): number {
  return Math.round((valueEmu / slideHeightEmu) * refHeightPx * 1000) / 1000;
}

const EMU_PER_POINT = 12700;

/**
 * A run's font size (and paragraph spacing) is stored in points, a physical
 * unit independent of the source slide's own canvas size — unlike
 * position/size EMUs, a fixed `pt * 96/72` conversion doesn't know how far
 * `toSlidePxX`/`toSlidePxY` scaled that canvas down (or up) to fit the
 * deck's aspect-ratio box. Converting the point value to EMU first and
 * running it through the same `toSlidePxX` scale keeps text sized
 * proportionally to its box on every source slide size, not just the one
 * physical size (10in wide) that happens to make the fixed conversion agree
 * with the 16:9 preset's box.
 */
function ptToSlidePx(
  valuePt: number,
  widthEmu: number,
  refWidthPx: number,
): number {
  return toSlidePxX(valuePt * EMU_PER_POINT, widthEmu, refWidthPx);
}

function imageUrlForElement(
  element: ParsedElement,
  imageUrls: string | Record<string, string> | undefined,
): string | undefined {
  if (typeof imageUrls === "string") return imageUrls;
  return imageUrls?.[element.id];
}

function imageRenderStyle(element: ParsedElement): string {
  const crop = element.image?.crop;
  if (!crop) return "display:block;width:100%;height:100%;object-fit:fill;";
  const visibleWidth = Math.max(0.001, 1 - crop.left - crop.right);
  const visibleHeight = Math.max(0.001, 1 - crop.top - crop.bottom);
  return `display:block;position:absolute;left:${(-crop.left / visibleWidth) * 100}%;top:${(-crop.top / visibleHeight) * 100}%;width:${(1 / visibleWidth) * 100}%;height:${(1 / visibleHeight) * 100}%;object-fit:fill;`;
}

type ParsedTableCell = NonNullable<
  ParsedElement["table"]
>["rows"][number][number];

const DEFAULT_PPTX_TABLE_BORDER = "rgba(255,255,255,0.25)"; // guard:allow-raw-color - imported PPTX table cell border approximation, same fixed-contrast convention as the rest of this fidelity renderer

/** Render a parsed `"table"` element (a PPTX `graphicFrame`'s `a:tbl`) as a real HTML `<table>`, sized/positioned the same way every other fidelity element is. */
function buildFidelityTable(
  element: ParsedElement,
  widthEmu: number,
  refWidthPx: number,
  themeFont: string | undefined,
  position: string,
  rotation: string,
  objectId: string,
): string {
  const rows = element.table?.rows ?? [];
  const rowsHtml = rows
    .map(
      (row, rowIndex) =>
        `<tr${rowHeightStyle(element, rowIndex)}>${row
          .map((cell) =>
            buildFidelityTableCell(cell, widthEmu, refWidthPx, themeFont),
          )
          .join("")}</tr>`,
    )
    .join("");
  const columnWidths = element.table?.columnWidthsEmu ?? [];
  const totalColumnWidth = columnWidths.reduce(
    (total, width) => total + width,
    0,
  );
  const colgroup =
    totalColumnWidth > 0
      ? `<colgroup>${columnWidths
          .map(
            (width) =>
              `<col style="width:${(width / totalColumnWidth) * 100}%" />`,
          )
          .join("")}</colgroup>`
      : "";
  return `<div class="fmd-pptx-table" data-pptx-element-kind="table"${objectId} style="${position}${rotation} overflow: hidden;"><table style="width:100%;height:100%;border-collapse:collapse;table-layout:fixed;font-family:${cssFontFamily(themeFont)};">${colgroup}${rowsHtml}</table></div>`;
}

function rowHeightStyle(element: ParsedElement, rowIndex: number): string {
  const rowHeight = element.table?.rowHeightsEmu?.[rowIndex];
  if (!rowHeight || element.height <= 0) return "";
  return ` style="height:${(rowHeight / element.height) * 100}%"`;
}

function buildFidelityTableCell(
  cell: ParsedTableCell,
  widthEmu: number,
  refWidthPx: number,
  themeFont: string | undefined,
): string {
  const fill = cell.fill ? `background:${esc(cell.fill)};` : "";
  const paragraphsHtml = cell.paragraphs
    .map((paragraph, paragraphIndex) =>
      buildFidelityParagraph(
        paragraph,
        paragraphIndex,
        widthEmu,
        refWidthPx,
        themeFont,
        400,
      ),
    )
    .join("");
  return `<td colspan="${cell.colSpan ?? 1}" rowspan="${cell.rowSpan ?? 1}" style="border:1px solid ${DEFAULT_PPTX_TABLE_BORDER};padding:4px 8px;vertical-align:top;${fill}">${paragraphsHtml}</td>`;
}

function shapeDecoration(
  element: ParsedElement,
  widthEmu: number,
  refWidthPx: number,
): string {
  const fill = element.fill ? `background: ${esc(element.fill)};` : "";
  const line = element.lineColor
    ? `border: ${Math.max(1, toSlidePxX(element.lineWidth ?? 12700, widthEmu, refWidthPx))}px solid ${esc(element.lineColor)};`
    : "";
  const radius = element.shapeType === "roundRect" ? "border-radius: 6px;" : "";
  return `${fill}${line}${radius}`;
}

function textBoxStyle(
  element: ParsedElement,
  widthEmu: number,
  heightEmu: number,
  refBox: { width: number; height: number },
  themeFont: string | undefined,
): string {
  const padding = element.padding;
  const left = padding ? toSlidePxX(padding.left, widthEmu, refBox.width) : 0;
  const right = padding ? toSlidePxX(padding.right, widthEmu, refBox.width) : 0;
  const top = padding ? toSlidePxY(padding.top, heightEmu, refBox.height) : 0;
  const bottom = padding
    ? toSlidePxY(padding.bottom, heightEmu, refBox.height)
    : 0;
  const align = element.paragraphs?.[0]?.alignment ?? "left";
  const vertical =
    element.verticalAlign === "middle"
      ? "justify-content:center;"
      : element.verticalAlign === "bottom"
        ? "justify-content:flex-end;"
        : "justify-content:flex-start;";
  return `display:flex;flex-direction:column;${vertical}padding:${top}px ${right}px ${bottom}px ${left}px;font-family:${cssFontFamily(themeFont)};text-align:${align};overflow:visible;`;
}

function buildFidelityParagraph(
  paragraph: ParsedParagraph,
  paragraphIndex: number,
  widthEmu: number,
  refWidthPx: number,
  themeFont: string | undefined,
  defaultFontWeight: number,
): string {
  const firstRun = paragraph.runs[0];
  const fontSize = ptToSlidePx(firstRun?.fontSize ?? 18, widthEmu, refWidthPx);
  const lineHeight = paragraph.lineSpacing ?? 1.2;
  const bulletFontSize = ptToSlidePx(
    paragraph.bulletSize ?? firstRun?.fontSize ?? 18,
    widthEmu,
    refWidthPx,
  );
  // `min-width` (not a hard `width`) with `white-space:nowrap`: the parent
  // paragraph inherits `white-space:pre-wrap`, and a hard width sized for a
  // single bullet glyph wrapped multi-character auto-num bullets like "2."
  // internally — the digit on one line, the period pushed onto the next
  // alongside the paragraph text.
  const bullet = paragraph.bulletChar
    ? `<span aria-hidden="true" style="display:inline-block;min-width:${fontSize * 0.75}px;white-space:nowrap;margin-right:${fontSize * 0.65}px;color:${esc(paragraph.bulletColor ?? firstRun?.color ?? DEFAULT_PPTX_FOREGROUND)};font-family:${cssFontFamily(paragraph.bulletFontFamily ?? themeFont)};font-size:${bulletFontSize}px;">${esc(paragraph.bulletChar)}</span>`
    : "";
  const marginLeft = paragraph.marginLeftEmu
    ? toSlidePxX(paragraph.marginLeftEmu, widthEmu, refWidthPx)
    : 0;
  const indent = paragraph.indentEmu
    ? toSlidePxX(paragraph.indentEmu, widthEmu, refWidthPx)
    : 0;
  const spacingBefore = paragraph.spaceBeforePt ?? 0;
  const spacingAfter = paragraph.spaceAfterPt ?? 0;
  const bulletMargin = paragraph.bulletChar ? `margin-left:${indent}px;` : "";
  const marginBefore = ptToSlidePx(spacingBefore, widthEmu, refWidthPx);
  const marginAfter = ptToSlidePx(spacingAfter, widthEmu, refWidthPx);
  const text = paragraph.runs
    .map((run) =>
      formatFidelityRun(
        run,
        widthEmu,
        refWidthPx,
        themeFont,
        defaultFontWeight,
      ),
    )
    .join("");
  return `<p data-pptx-paragraph="${paragraphIndex}" style="display:block;flex:0 0 auto;text-align:${paragraph.alignment ?? "left"};white-space:pre-wrap;margin:${marginBefore}px 0 ${marginAfter}px;line-height:${lineHeight};font-size:${fontSize}px;min-height:${fontSize * lineHeight}px;padding-left:${marginLeft}px;text-indent:${paragraph.bulletChar ? 0 : indent}px;">${bullet.replace("display:inline-block;", `display:inline-block;${bulletMargin}`)}${text}</p>`;
}

function formatFidelityRun(
  run: ParsedTextRun,
  widthEmu: number,
  refWidthPx: number,
  themeFont: string | undefined,
  defaultFontWeight = 400,
): string {
  const styles = [
    `font-size:${ptToSlidePx(run.fontSize ?? 18, widthEmu, refWidthPx)}px`,
    `font-family:${cssFontFamily(run.fontFamily ?? themeFont)}`,
    `color:${esc(run.color ?? DEFAULT_PPTX_FOREGROUND)}`,
    `font-weight:${run.bold ? 700 : fontWeightForFamily(run.fontFamily, defaultFontWeight)}`,
    `font-style:${run.italic ? "italic" : "normal"}`,
    `text-decoration:${run.underline ? "underline" : "none"}`,
  ].join(";");
  const href = run.href && isSafeLinkHref(run.href) ? run.href : undefined;
  if (href) {
    return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" style="${styles};">${esc(run.content)}</a>`;
  }
  return `<span style="${styles};">${esc(run.content)}</span>`;
}

/** A source PDF/PPTX link annotation is untrusted input — only render schemes a browser treats as navigation, never `javascript:`/`data:`/etc. */
function isSafeLinkHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

function fontWeightForFamily(
  fontFamily: string | undefined,
  fallback: number,
): number {
  const normalized = fontFamily?.toLowerCase() ?? "";
  if (!normalized) return fallback;
  if (/(?:semi|demi)bold|semibold/.test(normalized)) return 600;
  if (/extra[- ]?bold|heavy/.test(normalized)) return 800;
  if (/bold/.test(normalized)) return 700;
  if (/medium/.test(normalized)) return 500;
  if (/light|thin/.test(normalized)) return 300;
  return 400;
}

function buildTitleSlide(
  paragraphs: ParsedTextRun[][],
  slide: ParsedSlide,
  fontFamily: string,
): string {
  const titlePara = paragraphs[0] ?? [];
  const subtitlePara = paragraphs[1] ?? [];

  const titleText = titlePara.map(formatRun).join(" ") || "Untitled Slide";
  const subtitleText = subtitlePara.map(formatRun).join(" ");

  return `<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; font-family: ${fontFamily};">
    <h1 style="font-size: 64px; font-weight: 900; color: #fff; line-height: 1.1; letter-spacing: -2px; margin: 0 0 24px 0;">${titleText}</h1>${subtitleText ? `\n    <p style="font-size: 22px; color: rgba(255,255,255,0.55); margin: 0;">${subtitleText}</p>` : ""}
</div>`;
}

function buildContentSlide(
  paragraphs: ParsedTextRun[][],
  slide: ParsedSlide,
  fontFamily: string,
): string {
  // First paragraph is the heading, rest are bullet points
  const headingPara = paragraphs[0] ?? [];
  const bulletParas = paragraphs.slice(1);

  const headingText = headingPara.map(formatRun).join(" ") || "Slide";

  let bulletsHtml = "";
  if (bulletParas.length > 0) {
    const bulletItems = bulletParas
      .map((para) => {
        const text = para.map(formatRun).join(" ");
        return `      <div style="display: flex; align-items: flex-start; gap: 16px;">
        <span style="font-size: 8px; color: #fff; margin-top: 8px; flex-shrink: 0;">&#x25CF;</span>
        <span style="font-size: 22px; color: rgba(255,255,255,0.85); line-height: 1.5;">${text}</span>
      </div>`;
      })
      .join("\n");

    bulletsHtml = `\n    <div class="fmd-animation-container" style="display: flex; flex-direction: column; gap: 20px;">
${bulletItems}
    </div>`;
  }

  return `<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: flex-start; font-family: ${fontFamily};">
    <div style="font-size: 14px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF; margin-bottom: 16px;">IMPORTED</div>
    <h2 style="font-size: 40px; font-weight: 900; color: #fff; line-height: 1.15; letter-spacing: -1px; margin: 0 0 48px 0;">${headingText}</h2>${bulletsHtml}
</div>`;
}

/**
 * Render the slide's embedded image, or a text placeholder if it couldn't
 * be uploaded. `objectFit` defaults to `contain` — the stacked-image layout
 * sizes its box to the shape's own placed aspect ratio specifically so the
 * source photo isn't cropped, but the embedded file's actual pixel ratio
 * can still differ slightly from that placed ratio, and `cover` would crop
 * to fill the box in that case, defeating the point. `cover` is only
 * correct for a full-bleed background image, which intentionally fills its
 * box edge-to-edge.
 */
function imageOrPlaceholder(
  imageUrl: string | undefined,
  imageName: string,
  style: string,
  objectFit: "cover" | "contain" = "contain",
): string {
  if (imageUrl) {
    return `<img src="${esc(imageUrl)}" alt="" style="${style} object-fit: ${objectFit};" />`;
  }
  return `<div class="fmd-img-placeholder" style="${style}">Imported image: ${esc(imageName)}</div>`;
}

/**
 * A PPTX slide's picture and heading always go through one of two real
 * designs, decided by how big the photo was placed on the original slide —
 * not by a single fixed template:
 *  - a near-full-slide photo (a cover/section photo) had its title overlaid
 *    on top of it in the original, so it's rendered full-bleed with the
 *    text overlaid over a legibility scrim;
 *  - a smaller inset photo (a card-style illustration) had its caption
 *    stacked below it, so it's rendered that way, sized to the image's own
 *    aspect ratio instead of a fixed box that would crop or stretch it.
 */
function buildImageSlide(
  paragraphs: ParsedTextRun[][],
  slide: ParsedSlide,
  imageUrl: string | undefined,
  fontFamily: string,
): string {
  if (imageUrl && slide.images[0]?.fullBleed) {
    return buildOverlayImageSlide(paragraphs, imageUrl, fontFamily);
  }
  return buildStackedImageSlide(paragraphs, slide, imageUrl, fontFamily);
}

/** Full-bleed photo with the heading/caption overlaid at the bottom behind a gradient scrim. */
function buildOverlayImageSlide(
  paragraphs: ParsedTextRun[][],
  imageUrl: string,
  fontFamily: string,
): string {
  const headingPara = paragraphs[0] ?? [];
  const headingHtml = headingPara.map(formatRun).join(" ") || "Slide";

  const captionParas = paragraphs.slice(1);
  const captionHtml = captionParas.length
    ? `<div class="fmd-animation-container" style="display: flex; flex-direction: column; gap: 8px;">${captionParas
        .map(
          (para) =>
            `<p style="font-size: 18px; color: rgba(255,255,255,0.75); /* guard:allow-raw-color - standalone imported slide HTML uses fixed contrast colors */ line-height: 1.5; margin: 0;">${para.map(formatRun).join(" ")}</p>`,
        )
        .join("\n")}</div>`
    : "";

  return `<div class="fmd-slide" style="position: relative; width: 100%; height: 100%; overflow: hidden;">
    <img src="${esc(imageUrl)}" alt="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;" />
    <div style="position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0) 80%);"></div>
    <div style="position: absolute; left: 0; right: 0; bottom: 0; padding: 56px 70px; font-family: ${fontFamily};">
      <h2 style="font-size: 40px; font-weight: 900; color: #fff; /* guard:allow-raw-color - standalone imported slide HTML uses fixed contrast colors */ line-height: 1.15; letter-spacing: -1px; margin: 0 0 ${captionHtml ? "12px" : "0"} 0;">${headingHtml}</h2>${captionHtml ? `\n      ${captionHtml}` : ""}
    </div>
</div>`;
}

/** Photo card on top (sized to its own aspect ratio), heading/caption below. */
function buildStackedImageSlide(
  paragraphs: ParsedTextRun[][],
  slide: ParsedSlide,
  imageUrl: string | undefined,
  fontFamily: string,
): string {
  const headingPara = paragraphs[0] ?? [];
  const headingText = headingPara.map(formatRun).join(" ") || "Slide";

  const captionParas = paragraphs.slice(1);
  const captionText = captionParas.length
    ? `<div class="fmd-animation-container" style="display: flex; flex-direction: column; gap: 8px;">${captionParas
        .map(
          (para) =>
            `<p style="font-size: 16px; color: rgba(255,255,255,0.7); /* guard:allow-raw-color - standalone imported slide HTML uses fixed contrast colors */ line-height: 1.5; margin: 0;">${para.map(formatRun).join(" ")}</p>`,
        )
        .join("\n")}</div>`
    : "";

  const imageName = slide.images[0]?.name ?? "image";
  // Size the box to the image's own placed aspect ratio instead of a fixed
  // height, so portrait and landscape source photos both render undistorted
  // — a fixed height forced `object-fit: cover` to crop whichever
  // orientation didn't match the assumed box.
  const aspectRatio = slide.images[0]?.aspectRatio ?? 16 / 9;
  // `max-width` (not `width: 100%`) so the aspect-ratio box is never forced
  // wider than the height cap allows — pinning width to 100% while also
  // capping height made `object-fit: cover` crop the image to fit, which
  // defeated the point of sizing the box to its real aspect ratio.
  const imageHtml = imageOrPlaceholder(
    imageUrl,
    imageName,
    `display: block; max-width: 100%; max-height: 320px; aspect-ratio: ${aspectRatio}; border-radius: 12px; margin: 0 auto 24px;`,
  );

  return `<div class="fmd-slide" style="padding: 64px 90px; display: flex; flex-direction: column; justify-content: flex-start; font-family: ${fontFamily};">
    ${imageHtml}
    <h2 style="font-size: 32px; font-weight: 900; color: #fff; /* guard:allow-raw-color - standalone imported slide HTML uses fixed contrast colors */ line-height: 1.2; letter-spacing: -0.5px; margin: 0 0 12px 0;">${headingText}</h2>${captionText ? `\n    ${captionText}` : ""}
</div>`;
}

/** Strip HTML tags to get plain text. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/** Convert document sections (from DOCX/PDF) into slide HTML strings. */
export function convertSectionsToSlides(
  sections: { heading: string; content: string }[],
): string[] {
  const slides: string[] = [];

  for (const section of sections) {
    const heading = section.heading || "Section";
    const plainContent = stripTags(section.content).trim();

    if (!plainContent && !section.heading) continue;

    // Split long content into multiple slides
    const lines = plainContent
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      // Section with just a heading becomes a section divider
      slides.push(
        `<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; font-family: 'Poppins', sans-serif;">
    <div style="font-size: 16px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF; margin-bottom: 20px;">${String(slides.length + 1).padStart(2, "0")}</div>
    <h2 style="font-size: 72px; font-weight: 900; color: #fff; line-height: 1.05; letter-spacing: -2px; margin: 0;">${esc(heading)}</h2>
</div>`,
      );
      continue;
    }

    // Group lines into chunks of ~5 for bullet slides
    const LINES_PER_SLIDE = 5;
    for (let i = 0; i < lines.length; i += LINES_PER_SLIDE) {
      const chunk = lines.slice(i, i + LINES_PER_SLIDE);
      const bulletItems = chunk
        .map(
          (
            line,
          ) => `      <div style="display: flex; align-items: flex-start; gap: 16px;">
        <span style="font-size: 8px; color: #fff; margin-top: 8px; flex-shrink: 0;">&#x25CF;</span>
        <span style="font-size: 22px; color: rgba(255,255,255,0.85); line-height: 1.5;">${esc(line)}</span>
      </div>`,
        )
        .join("\n");

      slides.push(
        `<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: flex-start; font-family: 'Poppins', sans-serif;">
    <div style="font-size: 14px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF; margin-bottom: 16px;">IMPORTED</div>
    <h2 style="font-size: 40px; font-weight: 900; color: #fff; line-height: 1.15; letter-spacing: -1px; margin: 0 0 48px 0;">${esc(heading)}</h2>
    <div style="display: flex; flex-direction: column; gap: 20px;">
${bulletItems}
    </div>
</div>`,
      );
    }
  }

  return slides;
}
