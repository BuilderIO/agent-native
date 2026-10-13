import type { PdfFidelityPage } from "./pdf-fidelity-parser.js";

const EMU_PER_POINT = 12700;
const MAX_TYPE_ROLES = 8;
const MAX_BACKGROUNDS = 4;
const MAX_SAMPLE_CHARS = 60;

export interface PdfTypeRole {
  fontSizePt: number;
  fontFamily: string | null;
  bold: boolean;
  color: string | null;
  runCount: number;
  sample: string;
}

export interface PdfStyleDigest {
  pageCount: number;
  pageWidthPt: number;
  pageHeightPt: number;
  orientation: "landscape" | "portrait" | "square";
  aspectRatio: number;
  backgroundColors: Array<{ color: string; pageCount: number }>;
  typeScale: PdfTypeRole[];
  paragraphAlignments: Array<{ alignment: string; blockCount: number }>;
  textMarginsPt: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  } | null;
  pagesWithImages: number;
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function orientationOf(
  widthPt: number,
  heightPt: number,
): PdfStyleDigest["orientation"] {
  const ratio = widthPt / heightPt;
  if (ratio > 1.02) return "landscape";
  if (ratio < 0.98) return "portrait";
  return "square";
}

export function buildPdfStyleDigest(
  pages: PdfFidelityPage[],
): PdfStyleDigest | null {
  if (pages.length === 0) return null;

  const first = pages[0];
  const pageWidthPt = round(first.widthEmu / EMU_PER_POINT, 1);
  const pageHeightPt = round(first.heightEmu / EMU_PER_POINT, 1);

  const backgroundPageCounts = new Map<string, number>();
  const typeRoles = new Map<
    string,
    { role: Omit<PdfTypeRole, "runCount">; runCount: number }
  >();
  const alignmentCounts = new Map<string, number>();
  const leftMargins: number[] = [];
  const rightMargins: number[] = [];
  const topMargins: number[] = [];
  const bottomMargins: number[] = [];
  let pagesWithImages = 0;

  for (const page of pages) {
    if (page.backgroundColor) {
      backgroundPageCounts.set(
        page.backgroundColor,
        (backgroundPageCounts.get(page.backgroundColor) ?? 0) + 1,
      );
    }

    const textElements = page.elements.filter(
      (element) => element.kind === "text" && element.paragraphs?.length,
    );
    if (
      page.imagesSkipped > 0 ||
      page.elements.some((element) => element.kind === "image")
    ) {
      pagesWithImages += 1;
    }

    for (const element of textElements) {
      for (const paragraph of element.paragraphs ?? []) {
        if (paragraph.alignment) {
          alignmentCounts.set(
            paragraph.alignment,
            (alignmentCounts.get(paragraph.alignment) ?? 0) + 1,
          );
        }
        for (const run of paragraph.runs) {
          const content = run.content.trim();
          if (!content) continue;
          const fontSizePt = round(run.fontSize ?? 0, 1);
          const fontFamily = run.fontFamily ?? null;
          const bold = run.bold === true;
          const color = run.color ?? null;
          const key = `${fontSizePt}|${fontFamily ?? ""}|${bold}|${color ?? ""}`;
          const existing = typeRoles.get(key);
          if (existing) {
            existing.runCount += 1;
            continue;
          }
          typeRoles.set(key, {
            role: {
              fontSizePt,
              fontFamily,
              bold,
              color,
              sample: content.slice(0, MAX_SAMPLE_CHARS),
            },
            runCount: 1,
          });
        }
      }
    }

    if (textElements.length === 0) continue;
    const pageWidthEmu = page.widthEmu;
    const pageHeightEmu = page.heightEmu;
    if (pageWidthEmu <= 0 || pageHeightEmu <= 0) continue;
    leftMargins.push(
      Math.min(...textElements.map((element) => element.x)) / EMU_PER_POINT,
    );
    rightMargins.push(
      (pageWidthEmu -
        Math.max(...textElements.map((element) => element.x + element.width))) /
        EMU_PER_POINT,
    );
    topMargins.push(
      Math.min(...textElements.map((element) => element.y)) / EMU_PER_POINT,
    );
    bottomMargins.push(
      (pageHeightEmu -
        Math.max(
          ...textElements.map((element) => element.y + element.height),
        )) /
        EMU_PER_POINT,
    );
  }

  return {
    pageCount: pages.length,
    pageWidthPt,
    pageHeightPt,
    orientation: orientationOf(pageWidthPt, pageHeightPt),
    aspectRatio: round(pageWidthPt / pageHeightPt, 3),
    backgroundColors: [...backgroundPageCounts.entries()]
      .map(([color, pageCount]) => ({ color, pageCount }))
      .sort((a, b) => b.pageCount - a.pageCount)
      .slice(0, MAX_BACKGROUNDS),
    typeScale: [...typeRoles.values()]
      .sort(
        (a, b) =>
          b.runCount - a.runCount || b.role.fontSizePt - a.role.fontSizePt,
      )
      .slice(0, MAX_TYPE_ROLES)
      .map(({ role, runCount }) => ({ ...role, runCount })),
    paragraphAlignments: [...alignmentCounts.entries()]
      .map(([alignment, blockCount]) => ({ alignment, blockCount }))
      .sort((a, b) => b.blockCount - a.blockCount),
    textMarginsPt:
      leftMargins.length > 0
        ? {
            left: round(median(leftMargins), 1),
            right: round(median(rightMargins), 1),
            top: round(median(topMargins), 1),
            bottom: round(median(bottomMargins), 1),
          }
        : null,
    pagesWithImages,
  };
}
