import { importExportModule } from "./dynamic-import";

/**
 * Marks the point where Chrome wrapped a line of slide text. Both code points
 * are default-ignorable, so the clone lays out exactly as before, and neither
 * dom-to-pptx nor PptxGenJS treats them as whitespace, so they survive into
 * `<a:t>`. `softBreaksFromWrapMarks` turns each one into an `<a:br/>`.
 */
export const WRAP_MARK = String.fromCharCode(0x2063, 0x2064);

const EMU_PER_POINT = 12_700;

/**
 * Google Slides re-wraps imported text with its own line breaker and has no
 * letter-spacing at all, so a box sized to Chrome's line either keeps the
 * break Chrome chose or ends up a line taller and spills onto whatever sits
 * below it. Pinning the breaks and leaving room for the tracking Google drops
 * keeps every line where the deck put it.
 */
const TEXT_WIDTH_TOLERANCE = 0.02;
const TEXT_WIDTH_SLACK_PT = 2;

const RUN_PATTERN =
  /<a:r>(<a:rPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:rPr>))?<a:t(\s[^>]*)?>([^<]*)<\/a:t><\/a:r>/g;

/** Replaces each wrap mark with a soft break that keeps the run's own formatting. */
export function softBreaksFromWrapMarks(xml: string): string {
  if (!xml.includes(WRAP_MARK)) return xml;
  return xml.replace(
    RUN_PATTERN,
    (
      run,
      runProperties: string | undefined,
      textAttributes = "",
      text: string,
    ) => {
      if (!text.includes(WRAP_MARK)) return run;
      const properties = runProperties ?? "";
      return text
        .split(WRAP_MARK)
        .map((part, index, parts) => {
          // Chrome never counts the space it wrapped at; a centered or
          // right-aligned line in Slides would.
          const content =
            index < parts.length - 1 ? part.replace(/ +$/, "") : part;
          const textRun = content
            ? `<a:r>${properties}<a:t${textAttributes}>${content}</a:t></a:r>`
            : "";
          return index === 0 ? textRun : `<a:br>${properties}</a:br>${textRun}`;
        })
        .join("");
    },
  );
}

function decodedLength(text: string): number {
  return text.replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/gi, "x").length;
}

/**
 * Widens every text box by the negative tracking Slides will drop from its
 * longest line, plus a small tolerance, keeping the box's aligned edge fixed.
 */
export function widenTextBoxes(xml: string): string {
  return xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (shape) => {
    if (!shape.includes("<p:txBody>")) return shape;
    const transform = shape.match(
      /<a:xfrm(\s[^>]*)?><a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/,
    );
    if (!transform || /\srot="-?[1-9]/.test(transform[1] ?? "")) return shape;
    const paragraphs = shape.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? [];
    // The box grows from its aligned edge, and a box mixing alignments has no
    // single edge to hold: growing it would slide some of its paragraphs.
    const alignments = new Set(
      paragraphs.map(
        (paragraph) =>
          paragraph.match(/<a:pPr\b[^>]*\salgn="(\w+)"/)?.[1] ?? "l",
      ),
    );
    const [align = "l"] = alignments;
    if (alignments.size > 1 || !["l", "ctr", "r"].includes(align)) {
      return shape;
    }

    let droppedTrackingPt = 0;
    for (const paragraph of paragraphs) {
      for (const line of paragraph.split(/<a:br\b/)) {
        let linePt = 0;
        for (const [, properties = "", , text] of line.matchAll(RUN_PATTERN)) {
          const spacing = Number(properties.match(/\sspc="(-?\d+)"/)?.[1] ?? 0);
          if (spacing < 0) linePt += (decodedLength(text) * -spacing) / 100;
        }
        droppedTrackingPt = Math.max(droppedTrackingPt, linePt);
      }
    }

    const [, attributes = "", x, y, cx, cy] = transform;
    const width = Number(cx);
    const extra = Math.round(
      droppedTrackingPt * EMU_PER_POINT +
        width * TEXT_WIDTH_TOLERANCE +
        TEXT_WIDTH_SLACK_PT * EMU_PER_POINT,
    );
    const shift = align === "ctr" ? extra / 2 : align === "r" ? extra : 0;
    return shape.replace(
      transform[0],
      `<a:xfrm${attributes}><a:off x="${Math.round(Number(x) - shift)}" y="${y}"/><a:ext cx="${width + extra}" cy="${cy}"/>`,
    );
  });
}

/** A face's ascent and descent, in em, as Chrome lays its lines out. */
export interface FontMetrics {
  ascent: number;
  descent: number;
}

/**
 * Slides sets a line's pitch at `spcPct × 1.2 × font size`. It also accepts
 * `spcPts`, but converts it against a paragraph-level size — an `<a:br/>` or
 * end-of-paragraph mark can change the result — so an exact pitch only lands
 * reliably as a percentage. Measured against Slides' own renderer; see
 * `retargetSlideXmlForGoogleSlides`.
 */
const GOOGLE_SLIDES_SINGLE_LINE_EM = 1.2;

/**
 * Converts each paragraph's exact line spacing to the percentage that gives
 * the same pitch in Slides, and sizes the end-of-paragraph mark like the text
 * so it cannot stretch the paragraph's last line.
 */
export function lineSpacingAsPercent(xml: string): string {
  return xml.replace(/<a:p>[\s\S]*?<\/a:p>/g, (paragraph) => {
    const sizes = [...paragraph.matchAll(/<a:rPr\b[^>]*\ssz="(\d+)"/g)].map(
      (match) => Number(match[1]),
    );
    if (!sizes.length) return paragraph;
    const size = Math.max(...sizes);
    return paragraph
      .replace(
        /<a:lnSpc><a:spcPts val="(\d+)"\/><\/a:lnSpc>/,
        (_match, points: string) =>
          `<a:lnSpc><a:spcPct val="${Math.round((Number(points) / (GOOGLE_SLIDES_SINGLE_LINE_EM * size)) * 100_000)}"/></a:lnSpc>`,
      )
      .replace(/(<a:endParaRPr\b[^>]*\ssz=")\d+"/, `$1${size}"`);
  });
}

/**
 * Moves each text box so its first baseline lands where Chrome drew it.
 *
 * Chrome centres a line's leading around the face's ascent and descent; Slides
 * puts the first baseline 0.96em below the top of the text area (scaled down
 * when the spacing is under 100%) and stacks a centred or bottom-anchored block
 * as one single-spaced line plus the pitch of every line after it. With the
 * pitch matched by `lineSpacingAsPercent`, the offset between the two depends
 * only on the anchor, the size, the line height and the face — never on the
 * number of lines — so one shift per box aligns every line in it.
 */
export function alignFirstBaselines(
  xml: string,
  fontMetrics: Record<string, FontMetrics>,
): string {
  return xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (shape) => {
    const bodyAttributes = shape.match(/<a:bodyPr\b([^>]*)>/)?.[1];
    const offset = shape.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
    const paragraph = shape.match(/<a:p>[\s\S]*?<\/a:p>/)?.[0];
    if (bodyAttributes === undefined || !offset || !paragraph) return shape;
    const points = paragraph.match(
      /<a:lnSpc><a:spcPts val="(\d+)"\/><\/a:lnSpc>/,
    )?.[1];
    const run = paragraph.match(/<a:rPr\b([^>]*?)(?:\/>|>([\s\S]*?)<\/a:rPr>)/);
    const size = Number(run?.[1].match(/\ssz="(\d+)"/)?.[1]) / 100;
    const face = run?.[2]?.match(/<a:latin typeface="([^"]+)"/)?.[1];
    const metrics = face ? fontMetrics[face] : undefined;
    if (!points || !(size > 0) || !metrics) return shape;

    const lineHeight = Number(points) / 100;
    const spacing = Math.min(
      1,
      lineHeight / (GOOGLE_SLIDES_SINGLE_LINE_EM * size),
    );
    const leading = (size * (metrics.ascent - metrics.descent)) / 2;
    const anchor = bodyAttributes.match(/\sanchor="(\w+)"/)?.[1] ?? "t";
    const shiftPt =
      anchor === "ctr"
        ? leading - 0.36 * size * spacing
        : anchor === "b"
          ? leading - lineHeight / 2 + 0.24 * size * spacing
          : leading + lineHeight / 2 - 0.96 * size * spacing;
    const shift = Math.round(shiftPt * EMU_PER_POINT);
    if (!shift) return shape;
    return shape.replace(
      offset[0],
      `<a:off x="${offset[1]}" y="${Number(offset[2]) + shift}"/>`,
    );
  });
}

/**
 * Takes a rounded rectangle's own text inset back out of its body insets.
 *
 * dom-to-pptx draws a CSS `border-radius` box as the `roundRect` preset, and
 * OOXML gives that preset a text rectangle inset from the shape by
 * `min(w, h) × adj × 0.29289` on every side — measured in Slides as a card's
 * text landing 2.9px right and down, and a pill's 4.4px. The HTML box has no
 * such inset; its padding is already the body inset.
 */
export function compensateRoundRectTextInsets(xml: string): string {
  return xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (shape) => {
    const adjust = shape.match(
      /<a:prstGeom prst="roundRect">\s*<a:avLst>\s*<a:gd name="adj" fmla="val (\d+)"\/>/,
    )?.[1];
    const size = shape.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
    if (!adjust || !size || !shape.includes("<p:txBody>")) return shape;
    const inset =
      Math.min(Number(size[1]), Number(size[2])) *
      (Math.min(Number(adjust), 50_000) / 100_000) *
      0.29289;
    return shape.replace(/<a:bodyPr\b[^>]*>/, (body) =>
      body.replace(
        /\s(lIns|tIns|rIns|bIns)="(\d+)"/g,
        (_match, side: string, value: string) =>
          ` ${side}="${Math.max(0, Math.round(Number(value) - inset))}"`,
      ),
    );
  });
}

/**
 * Tunes one slide's DrawingML for Google Slides' text layout, which differs
 * from PowerPoint's in line breaking, tracking, line pitch and first-baseline
 * placement. Every constant here was measured against Slides' own renderer.
 * Baselines are aligned before spacing is converted, since both read the
 * original point spacing.
 */
export function retargetSlideXmlForGoogleSlides(
  xml: string,
  fontMetrics: Record<string, FontMetrics> = {},
): string {
  return lineSpacingAsPercent(
    widenTextBoxes(
      compensateRoundRectTextInsets(
        alignFirstBaselines(softBreaksFromWrapMarks(xml), fontMetrics),
      ),
    ),
  );
}

/** Applies `retargetSlideXmlForGoogleSlides` to every slide in a PPTX package. */
export async function retargetPptxForGoogleSlides(
  blob: Blob,
  fontMetrics: Record<string, FontMetrics> = {},
): Promise<Blob> {
  const { default: JSZip } = await importExportModule(() => import("jszip"));
  const zip = await JSZip.loadAsync(blob);
  for (const name of Object.keys(zip.files)) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
    const xml = await zip.file(name)!.async("string");
    zip.file(name, retargetSlideXmlForGoogleSlides(xml, fontMetrics));
  }
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
