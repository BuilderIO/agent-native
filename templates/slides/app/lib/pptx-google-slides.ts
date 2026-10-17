import { importExportModule } from "./dynamic-import";

export const WRAP_MARK = String.fromCharCode(0x2063, 0x2064);

const EMU_PER_POINT = 12_700;

const TEXT_WIDTH_TOLERANCE = 0.02;
const TEXT_WIDTH_SLACK_PT = 2;

const RUN_PATTERN =
  /<a:r>(<a:rPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:rPr>))?<a:t(\s[^>]*)?>([^<]*)<\/a:t><\/a:r>/g;

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

export function widenTextBoxes(xml: string): string {
  return xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (shape) => {
    if (!shape.includes("<p:txBody>")) return shape;
    const transform = shape.match(
      /<a:xfrm(\s[^>]*)?><a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/,
    );
    if (!transform || /\srot="-?[1-9]/.test(transform[1] ?? "")) return shape;
    const paragraphs = shape.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? [];
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

export interface FontMetrics {
  ascent: number;
  descent: number;
}

const GOOGLE_SLIDES_SINGLE_LINE_EM = 1.2;

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
