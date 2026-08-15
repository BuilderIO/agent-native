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
 * OOXML's own default run size, used only when the run, its placeholder
 * chain, and the deck's `<p:defaultTextStyle>` all fail to state one.
 * KNOWN GAP: the parser does not read `<p:defaultTextStyle>` or the master's
 * `<p:otherStyle>`, and real decks routinely declare 14pt there — an unsized
 * run in one of those decks renders 28% oversized and overflows its authored
 * box. Fixing that needs the parser to surface the deck's declared default,
 * not a different constant here.
 */
const DEFAULT_PPTX_FONT_SIZE_PT = 18;

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
    // PowerPoint paints a picture inside its shape, so a portrait in an
    // `ellipse` frame is a circle, not the square its bounding box is. Text
    // is the one kind that must keep its box — clipping it would eat the
    // text with the outline.
    const imagePath = customGeometryPath(element, widthPx, heightPx);
    const clip = imagePath
      ? `clip-path: path('${imagePath}');`
      : geometryCss(
          element.shapeType,
          widthPx,
          heightPx,
          element.shapeAdjustments,
        );
    return `<div class="fmd-pptx-image" data-pptx-element-kind="image" data-pptx-image-name="${esc(element.image?.name ?? "image")}"${objectId} style="${position}${rotation} overflow: hidden;${clip}">${url ? `<img src="${esc(url)}" alt="" style="${imageStyle}" />` : `<div class="fmd-img-placeholder" style="width:100%;height:100%;">Imported image: ${esc(element.image?.name ?? "image")}</div>`}</div>`;
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

  // Text keeps its box: clipping a text element to its outline would eat the
  // text with it, which PowerPoint does not do either.
  const customPath =
    element.kind === "shape"
      ? customGeometryPath(element, widthPx, heightPx)
      : undefined;
  const outlinePath =
    element.kind === "shape"
      ? (customPath ??
        clippedPresetPath(
          element.shapeType,
          widthPx,
          heightPx,
          element.shapeAdjustments,
        ))
      : undefined;
  const decoration = shapeDecoration(
    element,
    widthEmu,
    refBox.width,
    widthPx,
    heightPx,
    customPath,
    outlinePath,
  );
  if (element.kind === "shape") {
    const stroke = outlinePath
      ? customGeometryStroke(
          element,
          outlinePath,
          widthEmu,
          refBox.width,
          widthPx,
          heightPx,
        )
      : "";
    return `<div class="fmd-pptx-shape" data-pptx-element-kind="shape"${objectId} style="${position}${rotation}${decoration}">${stroke}</div>`;
  }

  const textStyle = textBoxStyle(
    element,
    widthEmu,
    heightEmu,
    refBox,
    themeFont,
  );
  const defaultFontWeight = element.placeholderType === "title" ? 700 : 400;
  const boxFontSizePt = firstDeclaredFontSizePt(element.paragraphs);
  const paragraphs = (element.paragraphs ?? [])
    .map((paragraph, paragraphIndex) =>
      buildFidelityParagraph(
        paragraph,
        paragraphIndex,
        widthEmu,
        refBox.width,
        themeFont,
        defaultFontWeight,
        boxFontSizePt,
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

/**
 * ECMA-376's own default `a:tcPr` cell margins, in EMU (0.1in left/right,
 * 0.05in top/bottom). They run through the same slide scale as every other
 * measurement, so a portrait or otherwise non-16:9 deck gets margins
 * proportional to its own canvas instead of a fixed px pair sized for one
 * slide shape.
 */
const DEFAULT_TABLE_CELL_MARGIN_X_EMU = 91440;
const DEFAULT_TABLE_CELL_MARGIN_Y_EMU = 45720;

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
  const paddingY = toSlidePxX(
    DEFAULT_TABLE_CELL_MARGIN_Y_EMU,
    widthEmu,
    refWidthPx,
  );
  const paddingX = toSlidePxX(
    DEFAULT_TABLE_CELL_MARGIN_X_EMU,
    widthEmu,
    refWidthPx,
  );
  const borders = TABLE_CELL_SIDES.map((side) =>
    tableCellBorderCss(side, cell.borders?.[side], widthEmu, refWidthPx),
  ).join("");
  return `<td colspan="${cell.colSpan ?? 1}" rowspan="${cell.rowSpan ?? 1}" style="padding:${paddingY}px ${paddingX}px;vertical-align:top;${fill}${borders}">${paragraphsHtml}</td>`;
}

const TABLE_CELL_SIDES = ["top", "right", "bottom", "left"] as const;

/**
 * A side the source draws nothing on emits nothing: under
 * `border-collapse: collapse` an unset side yields to its neighbour's rule
 * rather than erasing it, which is what a table styled with only outer edges
 * needs. The 1px floor is there because the hairline these decks author
 * (9525 EMU = 0.75pt) scales below a device pixel on the reference canvas,
 * and a rule the browser rounds away is the same missing grid this is fixing.
 */
function tableCellBorderCss(
  side: (typeof TABLE_CELL_SIDES)[number],
  border: NonNullable<ParsedTableCell["borders"]>["top"],
  widthEmu: number,
  refWidthPx: number,
): string {
  if (!border) return "";
  const width = Math.max(
    1,
    toSlidePxX(border.widthEmu ?? 9525, widthEmu, refWidthPx),
  );
  return `border-${side}:${round3(width)}px ${border.dash ?? "solid"} ${esc(border.color)};`;
}

/**
 * Preset geometries whose real outline leaves most of their bounding box
 * empty — a ring, an L-bracket, a hooked arrow. There is no CSS shape for
 * them here, and painting the bounding box instead is not a degraded
 * rendering but an actively wrong one: it covers the neighbouring content
 * the real geometry leaves visible, so a four-ring diagram becomes one
 * opaque square over the title. Until a geometry is reproduced, its fill and
 * stroke are dropped rather than approximated by a rectangle.
 */
const UNRENDERABLE_GEOMETRIES = new Set([
  "arc",
  "bentUpArrow",
  "bracePair",
  "bracketPair",
  "chord",
  "circularArrow",
  "corner",
  "curvedDownArrow",
  "curvedLeftArrow",
  "curvedRightArrow",
  "curvedUpArrow",
  "donut",
  "frame",
  "leftBrace",
  "leftBracket",
  "leftCircularArrow",
  "noSmoking",
  "rightBrace",
  "rightBracket",
]);

/**
 * PowerPoint's own default `a:avLst` adjustment for the corner-rounding
 * presets, as a fraction of the shape's shortest side. The parser records
 * `a:prstGeom/@_prst` but not the adjust values, so a deck that overrides
 * `adj` (a 50% pill, say) still renders at this default.
 */
const DEFAULT_CORNER_ADJUSTMENT = 0.16667;

/**
 * Preset geometries reproduced as a `clip-path` polygon, keyed by
 * `a:prstGeom/@_prst`. `ss` is the shape's shortest side, which is what
 * OOXML's own guide formulas measure their adjustments against; each literal
 * fraction below is that preset's default `a:avLst` value.
 */
const CLIP_PATH_GEOMETRIES: Record<
  string,
  (
    w: number,
    h: number,
    ss: number,
    adj?: Record<string, number>,
  ) => [number, number][]
> = {
  halfFrame: (w, h, ss, adj) => {
    // An L-bracket: `adj2` is the top arm's thickness and `adj1` the left
    // arm's, each measured against the shortest side, and the inner corner is
    // mitred so the two arms meet along the box's own diagonal.
    const x1 = (ss * pin(0, adj?.adj2 ?? 33333, (100000 * w) / ss)) / 100000;
    const y1 =
      (ss * pin(0, adj?.adj1 ?? 33333, (100000 * (h - (h * x1) / w)) / ss)) /
      100000;
    return [
      [0, 0],
      [w, 0],
      [w - (y1 * w) / h, y1],
      [x1, y1],
      [x1, h - (x1 * h) / w],
      [0, h],
    ];
  },
  triangle: (w, h) => [
    [w / 2, 0],
    [w, h],
    [0, h],
  ],
  rtTriangle: (w, h) => [
    [0, 0],
    [w, h],
    [0, h],
  ],
  diamond: (w, h) => [
    [w / 2, 0],
    [w, h / 2],
    [w / 2, h],
    [0, h / 2],
  ],
  homePlate: (w, h, ss) => {
    const x = ss * 0.16667;
    return [
      [0, 0],
      [w - x, 0],
      [w, h / 2],
      [w - x, h],
      [0, h],
    ];
  },
  chevron: (w, h, ss) => {
    const x = ss * 0.5;
    return [
      [0, 0],
      [w - x, 0],
      [w, h / 2],
      [w - x, h],
      [0, h],
      [x, h / 2],
    ];
  },
  hexagon: (w, h, ss) => {
    const x = ss * 0.25;
    return [
      [x, 0],
      [w - x, 0],
      [w, h / 2],
      [w - x, h],
      [x, h],
      [0, h / 2],
    ];
  },
  trapezoid: (w, h, ss) => {
    const x = ss * 0.25;
    return [
      [x, 0],
      [w - x, 0],
      [w, h],
      [0, h],
    ];
  },
  parallelogram: (w, h, ss) => {
    const x = ss * 0.25;
    return [
      [x, 0],
      [w, 0],
      [w - x, h],
      [0, h],
    ];
  },
  octagon: (w, h, ss) => {
    const c = ss * 0.29289;
    return [
      [c, 0],
      [w - c, 0],
      [w, c],
      [w, h - c],
      [w - c, h],
      [c, h],
      [0, h - c],
      [0, c],
    ];
  },
  pentagon: (w, h) => [
    [w / 2, 0],
    [w, h * 0.38],
    [w * 0.82, h],
    [w * 0.18, h],
    [0, h * 0.38],
  ],
  plus: (w, h, ss) => {
    const a = ss * 0.25;
    return [
      [a, 0],
      [w - a, 0],
      [w - a, a],
      [w, a],
      [w, h - a],
      [w - a, h - a],
      [w - a, h],
      [a, h],
      [a, h - a],
      [0, h - a],
      [0, a],
      [a, a],
    ];
  },
  downArrow: (w, h, ss) => arrowPoints(w, h, ss, "down"),
  upArrow: (w, h, ss) => arrowPoints(w, h, ss, "up"),
  rightArrow: (w, h, ss) => arrowPoints(w, h, ss, "right"),
  leftArrow: (w, h, ss) => arrowPoints(w, h, ss, "left"),
};

function arrowPoints(
  w: number,
  h: number,
  ss: number,
  direction: "up" | "down" | "left" | "right",
): [number, number][] {
  const shaft = ss * 0.25;
  const head = ss * 0.5;
  if (direction === "down" || direction === "up") {
    const cx = w / 2;
    const base: [number, number][] = [
      [cx - shaft, 0],
      [cx + shaft, 0],
      [cx + shaft, h - head],
      [w, h - head],
      [cx, h],
      [0, h - head],
      [cx - shaft, h - head],
    ];
    return direction === "down"
      ? base
      : base.map(([x, y]) => [x, h - y] as [number, number]);
  }
  const cy = h / 2;
  const base: [number, number][] = [
    [0, cy - shaft],
    [w - head, cy - shaft],
    [w - head, 0],
    [w, cy],
    [w - head, h],
    [w - head, cy + shaft],
    [0, cy + shaft],
  ];
  return direction === "right"
    ? base
    : base.map(([x, y]) => [w - x, y] as [number, number]);
}

function toPercent(value: number, total: number): number {
  return Math.round((value / Math.max(total, 0.001)) * 10000) / 100;
}

/**
 * A `blockArc` is a ring segment: two concentric elliptical arcs joined at
 * their ends. Its three `a:avLst` adjustments — start angle, end angle, and
 * ring thickness — are the only thing distinguishing one segment of a
 * six-part ring diagram from another, so reproducing the preset from its
 * defaults would draw six identical half-rings stacked on each other.
 */
function blockArcPath(
  adjustments: Record<string, number> | undefined,
  widthPx: number,
  heightPx: number,
): string | undefined {
  const startAngle = (adjustments?.adj1 ?? 10800000) / 60000;
  const endAngle = (adjustments?.adj2 ?? 0) / 60000;
  // OOXML's own `pin 0 adj3 50000`: past half the shortest side the ring has
  // no hole left and the segment is a pie slice.
  const thickness = Math.min(Math.max(adjustments?.adj3 ?? 25000, 0), 50000);
  // A swing of zero is a *whole* ring, not an empty one; the tiny shortfall
  // keeps the two arcs from collapsing onto the same point, where SVG draws
  // nothing at all.
  let swing = endAngle - startAngle;
  while (swing <= 0) swing += 360;
  swing = Math.min(swing, 359.9);
  const outerX = widthPx / 2;
  const outerY = heightPx / 2;
  const inset = (Math.min(widthPx, heightPx) * thickness) / 100000;
  const innerX = outerX - inset;
  const innerY = outerY - inset;
  if (!(innerX > 0) || !(innerY > 0)) return undefined;
  // ponytail: parametric angles, exact for a circular block arc — which is
  // every one in the decks this was measured against. A markedly elliptical
  // one starts and ends a few degrees around from where PowerPoint puts it;
  // OOXML's `cat2`/`sat2` true-angle correction is the upgrade.
  const at = (radiusX: number, radiusY: number, degrees: number) => {
    const angle = (degrees * Math.PI) / 180;
    return `${round1(outerX + radiusX * Math.cos(angle))} ${round1(outerY + radiusY * Math.sin(angle))}`;
  };
  const large = swing > 180 ? 1 : 0;
  return [
    `M${at(outerX, outerY, startAngle)}`,
    `A${round1(outerX)} ${round1(outerY)} 0 ${large} 1 ${at(outerX, outerY, startAngle + swing)}`,
    `L${at(innerX, innerY, startAngle + swing)}`,
    `A${round1(innerX)} ${round1(innerY)} 0 ${large} 0 ${at(innerX, innerY, startAngle)}`,
    "Z",
  ].join(" ");
}

/** OOXML's `pin`: a preset's declared adjustment clamped to the range its own guides allow. */
function pin(min: number, value: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * OOXML angles are 60000ths of a degree, and on an ellipse they are the angle
 * a ray from the centre actually makes, not the parametric angle whose sine
 * and cosine give the point. The presets say so themselves: `pie` computes its
 * arc's endpoints with `cat2`/`sat2`, which is this correction, and those
 * endpoints must land where its own `arcTo` lands or the slice never closes.
 * On a circular arc — every arc in the two arrow presets — it is the identity.
 */
function ellipseAngle(
  angle60k: number,
  radiusX: number,
  radiusY: number,
): number {
  const radians = (angle60k / 60000) * (Math.PI / 180);
  return Math.atan2(radiusX * Math.sin(radians), radiusY * Math.cos(radians));
}

/**
 * Draws one preset outline as an SVG path in the shape's own pixel box. An
 * OOXML `arcTo` gives radii and a start/sweep angle but neither the centre nor
 * the end point SVG's `A` needs — the current point is the arc's start, so the
 * centre is that point walked back along the start angle.
 *
 * `flipH`/`flipV` mirror the geometry before the element's CSS rotation runs,
 * and are folded into the coordinates rather than added to the `transform`,
 * which would mirror any text the box carries along with its outline.
 */
function presetPen(
  widthPx: number,
  heightPx: number,
  flipH?: boolean,
  flipV?: boolean,
) {
  const parts: string[] = [];
  const toX = (x: number) => round1(flipH ? widthPx - x : x);
  const toY = (y: number) => round1(flipV ? heightPx - y : y);
  // A single mirror reverses the direction an arc sweeps in; two cancel out.
  const mirrored = Boolean(flipH) !== Boolean(flipV);
  let currentX = 0;
  let currentY = 0;
  const emit = (command: string, points: [number, number][]) => {
    const last = points[points.length - 1]!;
    currentX = last[0];
    currentY = last[1];
    parts.push(
      `${command}${points.map(([x, y]) => `${toX(x)} ${toY(y)}`).join(" ")}`,
    );
  };
  return {
    move: (x: number, y: number) => emit("M", [[x, y]]),
    line: (x: number, y: number) => emit("L", [[x, y]]),
    cubic: (points: [number, number][]) => emit("C", points),
    arc: (
      radiusX: number,
      radiusY: number,
      start60k: number,
      swing60k: number,
    ) => {
      const start = ellipseAngle(start60k, radiusX, radiusY);
      const end = ellipseAngle(start60k + swing60k, radiusX, radiusY);
      const centerX = currentX - radiusX * Math.cos(start);
      const centerY = currentY - radiusY * Math.sin(start);
      currentX = centerX + radiusX * Math.cos(end);
      currentY = centerY + radiusY * Math.sin(end);
      const large = Math.abs(swing60k) > 180 * 60000 ? 1 : 0;
      const sweep = swing60k >= 0 !== mirrored ? 1 : 0;
      parts.push(
        `A${round1(radiusX)} ${round1(radiusY)} 0 ${large} ${sweep} ${toX(currentX)} ${toY(currentY)}`,
      );
    },
    close: () => parts.push("Z"),
    path: () => parts.join(" "),
  };
}

/**
 * Preset geometries whose outline needs an arc or a curve, so no polygon can
 * state them. Each is OOXML's own `gdLst` and `pathLst` for that preset
 * evaluated against the shape's box and its `a:avLst` adjustments — a
 * `uturnArrow`'s shaft width, head width, head length and bend radius all live
 * there, and a version built from the preset's defaults draws a different
 * arrow from the one the deck asked for.
 */
const PRESET_PATH_GEOMETRIES: Record<
  string,
  (
    pen: ReturnType<typeof presetPen>,
    w: number,
    h: number,
    adj: Record<string, number> | undefined,
  ) => void
> = {
  heart: (pen, w, h) => {
    // The one preset here with no adjustments at all: two cubics whose control
    // points sit outside the box on purpose — `hc - dx1` is left of it and
    // `y1` is a third of the height above it, which is what gives the lobes
    // their overhang.
    const hc = w / 2;
    const quarter = h / 4;
    const dx1 = (w * 49) / 48;
    const dx2 = (w * 10) / 48;
    const y1 = -h / 3;
    pen.move(hc, quarter);
    pen.cubic([
      [hc + dx2, y1],
      [hc + dx1, quarter],
      [hc, h],
    ]);
    pen.cubic([
      [hc - dx1, quarter],
      [hc - dx2, y1],
      [hc, quarter],
    ]);
    pen.close();
  },
  pie: (pen, w, h, adj) => {
    const radiusX = w / 2;
    const radiusY = h / 2;
    const startAngle = pin(0, adj?.adj1 ?? 0, 21599999);
    const endAngle = pin(0, adj?.adj2 ?? 16200000, 21599999);
    const span = endAngle - startAngle;
    // OOXML's `?: sw1 sw1 sw2` wraps a backwards slice forward a full turn. A
    // slice that then closes on itself is a whole disc in PowerPoint but draws
    // nothing at all in SVG, where the arc's two ends coincide.
    const swing = Math.min(span > 0 ? span : span + 21600000, 21594000);
    const start = ellipseAngle(startAngle, radiusX, radiusY);
    pen.move(
      radiusX + radiusX * Math.cos(start),
      radiusY + radiusY * Math.sin(start),
    );
    pen.arc(radiusX, radiusY, startAngle, swing);
    pen.line(radiusX, radiusY);
    pen.close();
  },
  uturnArrow: (pen, w, h, adj) => {
    // A stadium-shaped arrow: two parallel straight runs joined by a 180°
    // bend, with the head on the returning run. `adj1` is the shaft width,
    // `adj2` the half head width, `adj3` the head length, `adj4` the bend
    // radius and `adj5` how far down the box the head's tip reaches — each a
    // fraction of the shortest side except `adj5`, which is of the height.
    const ss = Math.min(w, h);
    const a2 = pin(0, adj?.adj2 ?? 25000, 25000);
    const a1 = pin(0, adj?.adj1 ?? 25000, a2 * 2);
    const a3 = pin(0, adj?.adj3 ?? 25000, ((100000 - (a1 * ss) / h) * h) / ss);
    const a5 = pin(((a3 + a1) * ss) / h, adj?.adj5 ?? 75000, 100000);
    const th = (ss * a1) / 100000;
    const aw2 = (ss * a2) / 100000;
    const dh2 = aw2 - th / 2;
    const y5 = (h * a5) / 100000;
    const y4 = y5 - (ss * a3) / 100000;
    const x9 = w - dh2;
    const a4 = pin(0, adj?.adj4 ?? 43750, (Math.min(x9 / 2, y4) * 100000) / ss);
    const bd = (ss * a4) / 100000;
    const bd2 = Math.max(bd - th, 0);
    const x3 = th + bd2;
    const x8 = w - aw2;
    const x6 = x8 - aw2;
    const x7 = x6 + dh2;
    pen.move(0, h);
    pen.line(0, bd);
    pen.arc(bd, bd, 10800000, 5400000);
    pen.line(x9 - bd, 0);
    pen.arc(bd, bd, 16200000, 5400000);
    pen.line(x9, y4);
    pen.line(w, y4);
    pen.line(x8, y5);
    pen.line(x6, y4);
    pen.line(x7, y4);
    // Not a mis-copied `y3`: OOXML reuses the guide named `x3` as this
    // vertical, and it is where the inner bend starts.
    pen.line(x7, x3);
    pen.arc(bd2, bd2, 0, -5400000);
    pen.line(x3, th);
    pen.arc(bd2, bd2, 16200000, -5400000);
    pen.line(th, h);
    pen.close();
  },
  bentArrow: (pen, w, h, adj) => {
    // The same shaft/head/bend adjustments as `uturnArrow`, but one 90° bend
    // instead of a 180° one: up the left edge, round the corner, right to a
    // head pointing at the box's right side.
    const ss = Math.min(w, h);
    const a2 = pin(0, adj?.adj2 ?? 25000, 50000);
    const a1 = pin(0, adj?.adj1 ?? 25000, a2 * 2);
    const a3 = pin(0, adj?.adj3 ?? 25000, 50000);
    const th = (ss * a1) / 100000;
    const aw2 = (ss * a2) / 100000;
    const dh2 = aw2 - th / 2;
    const ah = (ss * a3) / 100000;
    const a4 = pin(
      0,
      adj?.adj4 ?? 43750,
      (100000 * Math.min(w - ah, h - dh2)) / ss,
    );
    const bd = (ss * a4) / 100000;
    const bd2 = Math.max(bd - th, 0);
    const x4 = w - ah;
    const y3 = dh2 + th;
    pen.move(0, h);
    pen.line(0, dh2 + bd);
    pen.arc(bd, bd, 10800000, 5400000);
    pen.line(x4, dh2);
    pen.line(x4, 0);
    pen.line(w, aw2);
    pen.line(x4, y3 + dh2);
    pen.line(x4, y3);
    pen.line(th + bd2, y3);
    pen.arc(bd2, bd2, 16200000, -5400000);
    pen.line(th, h);
    pen.close();
  },
};

function presetGeometryPath(
  element: ParsedElement,
  widthPx: number,
  heightPx: number,
): string | undefined {
  const build = element.shapeType
    ? PRESET_PATH_GEOMETRIES[element.shapeType]
    : undefined;
  if (!build) return undefined;
  if (!(widthPx > 0) || !(heightPx > 0)) return undefined;
  const pen = presetPen(widthPx, heightPx, element.flipH, element.flipV);
  build(pen, widthPx, heightPx, element.shapeAdjustments);
  return pen.path();
}

/**
 * Reproduce the shape's declared preset geometry. `shapeType` is the only
 * geometry the parser records, so this maps the preset to the CSS that draws
 * it — without it every preset renders as the plain rectangle its bounding
 * box happens to be.
 */
function geometryCss(
  element: ParsedElement,
  widthPx: number,
  heightPx: number,
): string {
  const shapeType = element.shapeType;
  const adjustments = element.shapeAdjustments;
  if (!shapeType) return "";
  const shortest = Math.min(widthPx, heightPx);
  const corner = round3(shortest * DEFAULT_CORNER_ADJUSTMENT);
  switch (shapeType) {
    case "ellipse":
    case "smileyFace":
      return "border-radius: 50%;";
    case "roundRect":
      return `border-radius: ${corner}px;`;
    case "round1Rect":
      return `border-radius: 0 ${corner}px 0 0;`;
    case "round2SameRect":
      return `border-radius: ${corner}px ${corner}px 0 0;`;
    case "round2DiagRect":
      return `border-radius: ${corner}px 0 ${corner}px 0;`;
    case "blockArc": {
      const path = blockArcPath(adjustments, widthPx, heightPx);
      return path ? `clip-path: path('${path}');` : "";
    }
  }
  const points = CLIP_PATH_GEOMETRIES[shapeType]?.(widthPx, heightPx, shortest);
  if (!points) return "";
  const polygon = points
    .map(([x, y]) => `${toPercent(x, widthPx)}% ${toPercent(y, heightPx)}%`)
    .join(", ");
  return `clip-path: polygon(${polygon});`;
}

/**
 * The outline a preset geometry is *clipped* to, as an SVG path — the same
 * shape `geometryCss` writes into `clip-path`, in the form a stroke can
 * follow. `border` only paints the bounding box's four edges, so on a clipped
 * preset the clip then removes every part of them the outline does not cover:
 * a stroke-only triangle keeps a sliver of its base and loses both diagonals,
 * which is the whole shape gone. Presets that clip nothing (`ellipse`,
 * `roundRect`) are absent on purpose — `border` plus `border-radius` draws
 * those correctly.
 */
function clippedPresetPath(
  shapeType: string | undefined,
  widthPx: number,
  heightPx: number,
  adjustments?: Record<string, number>,
): string | undefined {
  if (!shapeType) return undefined;
  if (shapeType === "blockArc") {
    return blockArcPath(adjustments, widthPx, heightPx);
  }
  const points = CLIP_PATH_GEOMETRIES[shapeType]?.(
    widthPx,
    heightPx,
    Math.min(widthPx, heightPx),
    adjustments,
  );
  if (!points) return undefined;
  return `${points
    .map(
      ([x, y], index) => `${index === 0 ? "M" : "L"}${round1(x)} ${round1(y)}`,
    )
    .join(" ")} Z`;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Path coordinates are rounded harder than the rest of the renderer: a single
 * freeform illustration can carry ten thousand of them, and at the 960px
 * reference width 0.1px is well under one device pixel on any display. Three
 * decimals instead costs ~25% more HTML on a slide that is already the
 * largest this importer produces.
 */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Freeform path data is by far the largest thing this importer stores: one
 * decorative layout illustration in a real template is 86KB of coordinates,
 * and the layout layer repeats it on every slide that uses the layout. Writing
 * it in absolute commands spends 5-6 characters per coordinate on the shape's
 * own box origin; the same outline in relative commands spends 1-3 on the step
 * from the previous point.
 *
 * Deltas are measured against the point that was actually *emitted*, never the
 * exact one, so per-step rounding cannot accumulate: every emitted point stays
 * within half a rounding unit of its true position no matter how many
 * thousands of segments precede it.
 */
function createPathWriter() {
  let out = "";
  let lastCommand = "";
  let afterLetter = false;
  let previousNumberHadPoint = false;
  let x = 0;
  let y = 0;
  let subpathX = 0;
  let subpathY = 0;

  /** Writes the shortest legal spelling of `value` and returns what it rounded to. */
  const number = (value: number): number => {
    const rounded = round1(value);
    let text = String(rounded);
    if (text.startsWith("0.")) text = text.slice(1);
    else if (text.startsWith("-0.")) text = `-${text.slice(2)}`;
    // A leading `.` only runs into the previous number when that one had no
    // decimal point of its own: `1 .5` may compact to `1.5`, which is one
    // number, but `1.5 .5` reads as two either way.
    const joins =
      afterLetter ||
      text.startsWith("-") ||
      (text.startsWith(".") && previousNumberHadPoint);
    out += joins ? text : ` ${text}`;
    afterLetter = false;
    previousNumberHadPoint = text.includes(".");
    return rounded;
  };

  const command = (letter: string) => {
    // SVG repeats the previous command for a bare run of coordinates, and the
    // command implied after a `moveto` is `lineto`.
    if (lastCommand === letter) return;
    out += letter;
    afterLetter = true;
    lastCommand = letter === "m" ? "l" : letter;
  };

  return {
    /** `points` are absolute px; every one is written relative to the point the command starts from. */
    write(letter: string, points: { x: number; y: number }[]) {
      command(letter);
      const fromX = x;
      const fromY = y;
      for (const point of points) {
        x = fromX + number(point.x - fromX);
        y = fromY + number(point.y - fromY);
      }
      if (letter === "m") {
        subpathX = x;
        subpathY = y;
      }
    },
    arc(
      radiusX: number,
      radiusY: number,
      largeArc: number,
      sweep: number,
      toX: number,
      toY: number,
    ) {
      command("a");
      number(radiusX);
      number(radiusY);
      number(0);
      number(largeArc);
      number(sweep);
      const fromX = x;
      const fromY = y;
      x = fromX + number(toX - fromX);
      y = fromY + number(toY - fromY);
    },
    close() {
      out += "z";
      afterLetter = true;
      // `z` returns the pen to where the subpath started, and no command is
      // implied after it.
      lastCommand = "";
      x = subpathX;
      y = subpathY;
    },
    result: () => out,
  };
}

/**
 * Convert a shape's `a:custGeom` outline into an SVG path `d` string in the
 * shape's own pixel box. Every OOXML path command has an exact SVG
 * counterpart, so a freeform outline — a country on a map, a line-art
 * pictogram, one segment of a curved-arrow ring — is reproduced rather than
 * flattened into the rectangle its bounding box happens to be, which is what
 * turns a 422-path world map into a field of staircase blocks.
 *
 * Returns `undefined` rather than a partial path when the geometry cannot be
 * converted, so the caller falls back to the shape's existing rendering
 * instead of clipping it down to a fragment.
 */
function customGeometryPath(
  element: ParsedElement,
  widthPx: number,
  heightPx: number,
): string | undefined {
  const geometry = element.geometry;
  if (!geometry || geometry.kind !== "custom") return undefined;
  if (!(widthPx > 0) || !(heightPx > 0)) return undefined;
  const writer = createPathWriter();
  let wrote = false;
  for (const path of geometry.paths) {
    const scaleX = widthPx / path.w;
    const scaleY = heightPx / path.h;
    // OOXML path space is top-left origin like SVG's, so only the shape's own
    // `flipH`/`flipV` mirror it — there is no axis flip to undo.
    const toX = (x: number) =>
      element.flipH ? widthPx - x * scaleX : x * scaleX;
    const toY = (y: number) =>
      element.flipV ? heightPx - y * scaleY : y * scaleY;
    let currentX = 0;
    let currentY = 0;
    for (const command of path.commands) {
      wrote = true;
      if (command.kind === "close") {
        writer.close();
        continue;
      }
      if (command.kind === "arcTo") {
        const start = (command.stAng / 60000) * (Math.PI / 180);
        const swing = (command.swAng / 60000) * (Math.PI / 180);
        // OOXML gives the arc's radii and angles but not its center: the
        // current point is the arc's start, so the center is that point
        // walked back along the start angle.
        const centerX = currentX - command.wR * Math.cos(start);
        const centerY = currentY - command.hR * Math.sin(start);
        currentX = centerX + command.wR * Math.cos(start + swing);
        currentY = centerY + command.hR * Math.sin(start + swing);
        const largeArc = Math.abs(command.swAng) > 180 * 60000 ? 1 : 0;
        // A single mirror reverses the direction the arc sweeps in; two
        // cancel out.
        const sweep =
          command.swAng >= 0 !==
          (Boolean(element.flipH) !== Boolean(element.flipV))
            ? 1
            : 0;
        writer.arc(
          command.wR * scaleX,
          command.hR * scaleY,
          largeArc,
          sweep,
          toX(currentX),
          toY(currentY),
        );
        continue;
      }
      const last = command.points[command.points.length - 1]!;
      currentX = last.x;
      currentY = last.y;
      writer.write(
        { moveTo: "m", lnTo: "l", quadBezTo: "q", cubicBezTo: "c" }[
          command.kind
        ],
        command.points.map((point) => ({ x: toX(point.x), y: toY(point.y) })),
      );
    }
  }
  return wrote ? writer.result() : undefined;
}

/**
 * A clipped outline's stroke follows the path, not the bounding box, so the
 * `border` shorthand cannot draw it — on a line-art pictogram or an
 * outline-only triangle (no fill, a stroked outline only) a border is exactly
 * the generic square the shape collapses into today. The path is stroked as
 * an overlay instead, leaving the fill to the div's own clipped background.
 */
function customGeometryStroke(
  element: ParsedElement,
  pathData: string,
  widthEmu: number,
  refWidthPx: number,
  widthPx: number,
  heightPx: number,
): string {
  if (!element.lineColor) return "";
  const stroke = Math.max(
    1,
    toSlidePxX(element.lineWidth ?? 12700, widthEmu, refWidthPx),
  );
  return `<svg viewBox="0 0 ${round3(widthPx)} ${round3(heightPx)}" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;"><path d="${esc(pathData)}" fill="none" stroke="${esc(element.lineColor)}" stroke-width="${stroke}" /></svg>`;
}

/**
 * A PPTX line or connector is a box with one dimension of zero — or thinner
 * than the two borders that would have to meet inside it. Emitting the
 * `border` shorthand on it paints *both* parallel edges, so the rule draws at
 * twice its authored weight, overruns its own length by the stroke width at
 * each end, and grows perpendicular nubs from the two edges that should not
 * exist at all. A box with no room for an interior gets the single edge it is.
 */
function strokeDecoration(
  element: ParsedElement,
  widthEmu: number,
  refWidthPx: number,
  widthPx: number,
  heightPx: number,
): string {
  if (!element.lineColor) return "";
  const stroke = Math.max(
    1,
    toSlidePxX(element.lineWidth ?? 12700, widthEmu, refWidthPx),
  );
  const color = esc(element.lineColor);
  // The longer axis has to win, or a small square outline (a 2px dot, say)
  // would lose three of its four edges.
  if (heightPx < stroke * 2 && widthPx > heightPx) {
    return `border-top: ${stroke}px solid ${color};`;
  }
  if (widthPx < stroke * 2 && heightPx > widthPx) {
    return `border-left: ${stroke}px solid ${color};`;
  }
  return `border: ${stroke}px solid ${color};`;
}

function shapeDecoration(
  element: ParsedElement,
  widthEmu: number,
  refWidthPx: number,
  widthPx: number,
  heightPx: number,
  customPath: string | undefined,
  outlinePath: string | undefined,
): string {
  // A reproduced outline is no longer an occluding box, so it paints its real
  // fill even when its preset is one this renderer cannot otherwise draw.
  if (
    !customPath &&
    element.shapeType &&
    UNRENDERABLE_GEOMETRIES.has(element.shapeType)
  ) {
    return "";
  }
  const fill = element.fill ? `background: ${esc(element.fill)};` : "";
  if (customPath) {
    // No `border`: the stroke follows the outline, and `customGeometryStroke`
    // draws it. Clipping an unfilled box would only eat half that stroke, so
    // the clip is the fill's, not the shape's.
    return fill ? `${fill}clip-path: path('${customPath}');` : "";
  }
  // Same reason as above for a clipped preset: `border` draws the box, the
  // clip eats it, and `customGeometryStroke` draws the outline instead.
  const line = outlinePath
    ? ""
    : strokeDecoration(element, widthEmu, refWidthPx, widthPx, heightPx);
  return `${fill}${line}${geometryCss(element.shapeType, widthPx, heightPx, element.shapeAdjustments)}`;
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

/**
 * OOXML's default `a:lnSpc` is `spcPct val="100000"` — single spacing. The
 * parser resolves that declared value against the font's own line height
 * (`SINGLE_LINE_SPACING_RATIO`), so an inherited default has to land on the
 * same number, or an unspecified paragraph renders tighter than the identical
 * paragraph that states its spacing explicitly.
 */
const DEFAULT_LINE_SPACING = 1.2;

/**
 * The first size any run in this text box declares. A blank spacer paragraph
 * has no run to read a size from, so it would otherwise fall back to the
 * format-wide default and reserve a taller empty line than the copy it
 * separates — every blank paragraph in a 14pt box adding a few px of drift
 * that pushes the rest of the box down. Its real size lives in
 * `<a:endParaRPr>`, which the parser does not surface; the box's own declared
 * size is the closest value the source actually states.
 */
function firstDeclaredFontSizePt(
  paragraphs: ParsedParagraph[] | undefined,
): number | undefined {
  for (const paragraph of paragraphs ?? []) {
    for (const run of paragraph.runs) {
      if (run.fontSize !== undefined) return run.fontSize;
    }
  }
  return undefined;
}

function buildFidelityParagraph(
  paragraph: ParsedParagraph,
  paragraphIndex: number,
  widthEmu: number,
  refWidthPx: number,
  themeFont: string | undefined,
  defaultFontWeight: number,
  boxFontSizePt?: number,
): string {
  const firstRun = paragraph.runs[0];
  const paragraphFontSizePt =
    firstRun?.fontSize ??
    (paragraph.runs.length === 0 ? boxFontSizePt : undefined) ??
    DEFAULT_PPTX_FONT_SIZE_PT;
  const fontSize = ptToSlidePx(paragraphFontSizePt, widthEmu, refWidthPx);
  const lineHeight = paragraph.lineSpacing ?? DEFAULT_LINE_SPACING;
  const bulletFontSize = ptToSlidePx(
    paragraph.bulletSize ?? paragraphFontSizePt,
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
  // A right-to-left paragraph needs its base direction stated, or the browser
  // infers one per run and mixed Arabic/Latin/numeral text reorders differently
  // than PowerPoint laid it out. The `dir` attribute is the semantic form the
  // export DOM walker and any non-sanitizing consumer read, but it is not in
  // `sanitizeSlideHtml`'s ALLOWED_ATTRS — so the CSS equivalent has to carry it
  // through the renderer, where only `style` survives.
  const direction = paragraph.rtl ? ` dir="rtl"` : "";
  const directionCss = paragraph.rtl ? "direction:rtl;" : "";
  return `<p data-pptx-paragraph="${paragraphIndex}"${direction} style="${directionCss}display:block;flex:0 0 auto;text-align:${paragraph.alignment ?? (paragraph.rtl ? "right" : "left")};white-space:pre-wrap;margin:${marginBefore}px 0 ${marginAfter}px;line-height:${lineHeight};font-size:${fontSize}px;min-height:${fontSize * lineHeight}px;padding-left:${marginLeft}px;text-indent:${paragraph.bulletChar ? 0 : indent}px;">${bullet.replace("display:inline-block;", `display:inline-block;${bulletMargin}`)}${text}</p>`;
}

function formatFidelityRun(
  run: ParsedTextRun,
  widthEmu: number,
  refWidthPx: number,
  themeFont: string | undefined,
  defaultFontWeight = 400,
): string {
  const styles = [
    `font-size:${ptToSlidePx(run.fontSize ?? DEFAULT_PPTX_FONT_SIZE_PT, widthEmu, refWidthPx)}px`,
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
  if (/black|heavy/.test(normalized)) return 900;
  if (/extra[- ]?bold|ultra[- ]?bold/.test(normalized)) return 800;
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
