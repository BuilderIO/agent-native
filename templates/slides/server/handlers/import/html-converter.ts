import type { ParsedSlide, ParsedTextRun } from "./pptx-parser.js";

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
  if (run.bold) text = `<strong>${text}</strong>`;
  if (run.italic) text = `<em>${text}</em>`;
  return text;
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
 */
export function convertToSlideHtml(
  slide: ParsedSlide,
  imageUrl?: string,
): string {
  const paragraphs = groupIntoParagraphs(slide.texts);

  // An embedded image always wins the layout choice — a forced title slide
  // has no room to show it, which is how imports used to silently drop
  // photos from otherwise short/title-shaped slides.
  if (slide.images.length > 0) {
    return buildImageSlide(paragraphs, slide, imageUrl);
  }

  if (slide.layoutHint === "title" || paragraphs.length <= 2) {
    return buildTitleSlide(paragraphs, slide);
  }

  return buildContentSlide(paragraphs, slide);
}

function buildTitleSlide(
  paragraphs: ParsedTextRun[][],
  slide: ParsedSlide,
): string {
  const titlePara = paragraphs[0] ?? [];
  const subtitlePara = paragraphs[1] ?? [];

  const titleText = titlePara.map(formatRun).join(" ") || "Untitled Slide";
  const subtitleText = subtitlePara.map(formatRun).join(" ");

  return `<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; font-family: 'Poppins', sans-serif;">
    <h1 style="font-size: 64px; font-weight: 900; color: #fff; line-height: 1.1; letter-spacing: -2px; margin: 0 0 24px 0;">${titleText}</h1>${subtitleText ? `\n    <p style="font-size: 22px; color: rgba(255,255,255,0.55); margin: 0;">${subtitleText}</p>` : ""}
</div>`;
}

function buildContentSlide(
  paragraphs: ParsedTextRun[][],
  slide: ParsedSlide,
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

    bulletsHtml = `\n    <div style="display: flex; flex-direction: column; gap: 20px;">
${bulletItems}
    </div>`;
  }

  return `<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: flex-start; font-family: 'Poppins', sans-serif;">
    <div style="font-size: 14px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF; margin-bottom: 16px;">IMPORTED</div>
    <h2 style="font-size: 40px; font-weight: 900; color: #fff; line-height: 1.15; letter-spacing: -1px; margin: 0 0 48px 0;">${headingText}</h2>${bulletsHtml}
</div>`;
}

/** Render the slide's embedded image, or a text placeholder if it couldn't be uploaded. */
function imageOrPlaceholder(
  imageUrl: string | undefined,
  imageName: string,
  style: string,
): string {
  if (imageUrl) {
    return `<img src="${esc(imageUrl)}" alt="" style="${style} object-fit: cover;" />`;
  }
  return `<div class="fmd-img-placeholder" style="${style}">Imported image: ${esc(imageName)}</div>`;
}

function buildImageSlide(
  paragraphs: ParsedTextRun[][],
  slide: ParsedSlide,
  imageUrl?: string,
): string {
  const headingPara = paragraphs[0] ?? [];
  const headingText = headingPara.map(formatRun).join(" ") || "Slide";

  const captionParas = paragraphs.slice(1);
  const captionText = captionParas
    .map((para) => para.map(formatRun).join(" "))
    .join(" ");

  const imageName = slide.images[0]?.name ?? "image";
  const imageHtml = imageOrPlaceholder(
    imageUrl,
    imageName,
    "width: 100%; height: 300px; border-radius: 12px;",
  );

  return `<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: flex-start; font-family: 'Poppins', sans-serif;">
    <div style="font-size: 14px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF; margin-bottom: 16px;">IMPORTED</div>
    <h2 style="font-size: 40px; font-weight: 900; color: #fff; line-height: 1.15; letter-spacing: -1px; margin: 0 0 32px 0;">${headingText}</h2>
    ${imageHtml}${captionText ? `\n    <p style="font-size: 18px; color: rgba(255,255,255,0.55); margin: 24px 0 0 0;">${captionText}</p>` : ""}
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
