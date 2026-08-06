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

/** Turn an extracted PPTX theme font name into a safe CSS font-family value, falling back to the default when absent. */
function cssFontFamily(themeFont: string | undefined): string {
  if (!themeFont) return DEFAULT_IMPORT_FONT;
  const safeName = themeFont.replace(/["']/g, "").trim();
  return safeName ? `'${safeName}', sans-serif` : DEFAULT_IMPORT_FONT;
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
  if (slide.elements?.length) {
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
const CSS_PX_PER_POINT = 96 / 72;
const DEFAULT_PPTX_BACKGROUND = "#000000"; // guard:allow-raw-color - preserve PPTX black when no background is declared
const DEFAULT_PPTX_FOREGROUND = "#ffffff"; // guard:allow-raw-color - preserve PPTX white when no run color is declared

function buildFidelitySlide(
  slide: ParsedSlide,
  imageUrls: string | Record<string, string> | undefined,
  themeFont: string | undefined,
): string {
  const widthEmu = slide.widthEmu || DEFAULT_SLIDE_WIDTH_EMU;
  const heightEmu = slide.heightEmu || DEFAULT_SLIDE_HEIGHT_EMU;
  const background = slide.backgroundColor ?? DEFAULT_PPTX_BACKGROUND;
  const elements = slide.elements ?? [];
  const html = elements
    .map((element, index) =>
      buildFidelityElement(
        element,
        index,
        widthEmu,
        heightEmu,
        imageUrls,
        themeFont,
      ),
    )
    .join("\n");

  return `<div class="fmd-slide fmd-imported-pptx" data-imported-pptx="true" data-slide-width-emu="${widthEmu}" data-slide-height-emu="${heightEmu}" style="position: relative; width: 100%; height: 100%; overflow: hidden; background: ${esc(background)}; font-family: ${cssFontFamily(themeFont)};">${html}
</div>`;
}

function buildFidelityElement(
  element: ParsedElement,
  index: number,
  widthEmu: number,
  heightEmu: number,
  imageUrls: string | Record<string, string> | undefined,
  themeFont: string | undefined,
): string {
  const position = `position: absolute; left: ${toSlidePxX(element.x, widthEmu)}px; top: ${toSlidePxY(element.y, heightEmu)}px; width: ${toSlidePxX(element.width, widthEmu)}px; height: ${toSlidePxY(element.height, heightEmu)}px; z-index: ${index}; box-sizing: border-box;`;
  const rotation = element.rotation
    ? ` transform: rotate(${element.rotation}deg); transform-origin: center center;`
    : "";
  const objectId = ` data-slide-object-id="${esc(element.id)}"`;

  if (element.kind === "image") {
    const url = imageUrlForElement(element, imageUrls);
    const imageStyle = imageRenderStyle(element);
    return `<div class="fmd-pptx-image" data-pptx-element-kind="image" data-pptx-image-name="${esc(element.image?.name ?? "image")}"${objectId} style="${position}${rotation} overflow: hidden;">${url ? `<img src="${esc(url)}" alt="" style="${imageStyle}" />` : `<div class="fmd-img-placeholder" style="width:100%;height:100%;">Imported image: ${esc(element.image?.name ?? "image")}</div>`}</div>`;
  }

  const decoration = shapeDecoration(element, widthEmu);
  if (element.kind === "shape") {
    return `<div class="fmd-pptx-shape" data-pptx-element-kind="shape"${objectId} style="${position}${rotation}${decoration}"></div>`;
  }

  const textStyle = textBoxStyle(element, widthEmu, heightEmu, themeFont);
  const paragraphs = (element.paragraphs ?? [])
    .map((paragraph, paragraphIndex) =>
      buildFidelityParagraph(paragraph, paragraphIndex, widthEmu, themeFont),
    )
    .join("\n");
  return `<div class="fmd-pptx-text" data-pptx-element-kind="text"${objectId} style="${position}${rotation}${decoration}${textStyle}">${paragraphs}</div>`;
}

function toSlidePxX(valueEmu: number, slideWidthEmu: number): number {
  return Math.round((valueEmu / slideWidthEmu) * 960 * 1000) / 1000;
}

function toSlidePxY(valueEmu: number, slideHeightEmu: number): number {
  return Math.round((valueEmu / slideHeightEmu) * 540 * 1000) / 1000;
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

function shapeDecoration(element: ParsedElement, widthEmu: number): string {
  const fill = element.fill ? `background: ${esc(element.fill)};` : "";
  const line = element.lineColor
    ? `border: ${Math.max(1, toSlidePxX(element.lineWidth ?? 12700, widthEmu))}px solid ${esc(element.lineColor)};`
    : "";
  const radius = element.shapeType === "roundRect" ? "border-radius: 6px;" : "";
  return `${fill}${line}${radius}`;
}

function textBoxStyle(
  element: ParsedElement,
  widthEmu: number,
  heightEmu: number,
  themeFont: string | undefined,
): string {
  const padding = element.padding;
  const left = padding ? toSlidePxX(padding.left, widthEmu) : 0;
  const right = padding ? toSlidePxX(padding.right, widthEmu) : 0;
  const top = padding ? toSlidePxY(padding.top, heightEmu) : 0;
  const bottom = padding ? toSlidePxY(padding.bottom, heightEmu) : 0;
  const align = element.paragraphs?.[0]?.alignment ?? "left";
  const vertical =
    element.verticalAlign === "middle"
      ? "justify-content:center;"
      : element.verticalAlign === "bottom"
        ? "justify-content:flex-end;"
        : "justify-content:flex-start;";
  return `display:flex;flex-direction:column;${vertical}padding:${top}px ${right}px ${bottom}px ${left}px;font-family:${cssFontFamily(themeFont)};text-align:${align};overflow:hidden;`;
}

function buildFidelityParagraph(
  paragraph: ParsedParagraph,
  paragraphIndex: number,
  widthEmu: number,
  themeFont: string | undefined,
): string {
  const firstRun = paragraph.runs[0];
  const fontSize = (firstRun?.fontSize ?? 18) * CSS_PX_PER_POINT;
  const lineHeight = paragraph.lineSpacing ?? 1.2;
  const bullet = paragraph.bulletChar
    ? `<span aria-hidden="true" style="display:inline-block;width:${fontSize * 0.75}px;min-width:${fontSize * 0.75}px;margin-right:${fontSize * 0.65}px;color:${esc(paragraph.bulletColor ?? firstRun?.color ?? DEFAULT_PPTX_FOREGROUND)};font-family:${cssFontFamily(paragraph.bulletFontFamily ?? themeFont)};font-size:${(paragraph.bulletSize ?? firstRun?.fontSize ?? 18) * CSS_PX_PER_POINT}px;">${esc(paragraph.bulletChar)}</span>`
    : "";
  const marginLeft = paragraph.marginLeftEmu
    ? toSlidePxX(paragraph.marginLeftEmu, widthEmu)
    : 0;
  const indent = paragraph.indentEmu
    ? toSlidePxX(paragraph.indentEmu, widthEmu)
    : 0;
  const spacingBefore = paragraph.spaceBeforePt ?? 0;
  const spacingAfter = paragraph.spaceAfterPt ?? 0;
  const text = paragraph.runs
    .map((run) => formatFidelityRun(run, themeFont))
    .join("");
  return `<p data-pptx-paragraph="${paragraphIndex}" style="display:block;text-align:${paragraph.alignment ?? "left"};margin:${spacingBefore * CSS_PX_PER_POINT}px 0 ${spacingAfter * CSS_PX_PER_POINT}px;line-height:${lineHeight};font-size:${fontSize}px;min-height:${fontSize * lineHeight}px;padding-left:${marginLeft}px;text-indent:${indent}px;">${bullet}${text}</p>`;
}

function formatFidelityRun(
  run: ParsedTextRun,
  themeFont: string | undefined,
): string {
  const styles = [
    `font-size:${(run.fontSize ?? 18) * CSS_PX_PER_POINT}px`,
    `font-family:${cssFontFamily(run.fontFamily ?? themeFont)}`,
    `color:${esc(run.color ?? DEFAULT_PPTX_FOREGROUND)}`,
    `font-weight:${run.bold ? 700 : fontWeightForFamily(run.fontFamily)}`,
    `font-style:${run.italic ? "italic" : "normal"}`,
    `text-decoration:${run.underline ? "underline" : "none"}`,
  ].join(";");
  return `<span style="${styles};">${esc(run.content)}</span>`;
}

function fontWeightForFamily(fontFamily: string | undefined): number {
  const normalized = fontFamily?.toLowerCase() ?? "";
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
