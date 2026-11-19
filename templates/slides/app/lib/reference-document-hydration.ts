import { callAction } from "@agent-native/core/client/hooks";

import type { UploadedFile } from "@/components/editor/PromptDialog";

import {
  MAX_PPTX_SHAPE_CHARS,
  MAX_PPTX_SLIDES_IN_CONTEXT,
  pptxReferenceShapeSchema,
  serializePptxReferenceShape,
} from "../../shared/pptx-reference-shapes";

export const REFERENCE_HYDRATION_TIMEOUT_MS = 3 * 60 * 1000;

export const REFERENCE_HYDRATION_DEADLINE_MS = 4 * 60 * 1000;

const HYDRATION_CONCURRENCY = 3;

const MAX_CHARS_PER_REFERENCE = 12_000;
const MAX_TOTAL_REFERENCE_CHARS = 36_000;
const MIN_PARTIAL_REFERENCE_CHARS = 600;
const MAX_PDF_PAGES_IN_CONTEXT = 20;
const MAX_DOCX_SECTIONS_IN_CONTEXT = 20;

export type ReferenceDocumentFormat = "pdf" | "pptx" | "docx";

export interface ReferenceDocumentFailure {
  originalName: string;
  message: string;
}

export type ReferenceDocumentHydration =
  | { status: "none" }
  | {
      status: "hydrated";
      context: string;
      readCount: number;
      measuredDesignCount: number;
    }
  | {
      status: "unreadable";
      failures: ReferenceDocumentFailure[];
      message: string;
    };

export function referenceDocumentFormat(
  file: UploadedFile,
): ReferenceDocumentFormat | null {
  const name = file.originalName.toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".pptx")) return "pptx";
  if (name.endsWith(".docx")) return "docx";
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function singleLine(value: string): string {
  return value.replace(/[\r\n\u0085\u2028\u2029]+/g, " ");
}

type ReferencePart = string | { atomic: string };
type ReferenceBlock = {
  text: string;
  atomicRanges: { start: number; end: number }[];
};

function referenceBlock(parts: ReferencePart[]): ReferenceBlock {
  let text = "";
  const atomicRanges: ReferenceBlock["atomicRanges"] = [];
  for (const part of parts) {
    if (text) text += "\n";
    const start = text.length;
    text += typeof part === "string" ? singleLine(part) : part.atomic;
    if (typeof part !== "string")
      atomicRanges.push({ start, end: text.length });
  }
  return { text, atomicRanges };
}

function truncate(block: ReferenceBlock, maxChars: number): ReferenceBlock {
  if (block.text.length <= maxChars) return block;
  const marker = "\n[truncated]";
  let end = Math.max(0, maxChars - marker.length);
  const crossing = block.atomicRanges.find(
    (range) => range.start < end && end < range.end,
  );
  if (crossing) end = crossing.start;
  const text = block.text.slice(0, end).trimEnd();
  return {
    text: text + marker,
    atomicRanges: block.atomicRanges.filter(
      (range) => range.end <= text.length,
    ),
  };
}

function describeStyleDigest(result: Record<string, unknown>): string[] {
  const digest = asRecord(result.styleDigest);
  if (!digest) {
    const reason = asString(result.styleDigestUnavailableReason);
    return [
      reason
        ? `Visual style could not be measured from this PDF (${reason}). Follow the user's written styling instructions and say so if they asked to match this file's design.`
        : "Visual style could not be measured from this PDF. Follow the user's written styling instructions and say so if they asked to match this file's design.",
    ];
  }

  const lines = ["Measured visual language:"];
  const width = digest.pageWidthPt;
  const height = digest.pageHeightPt;
  if (typeof width === "number" && typeof height === "number") {
    lines.push(
      `- Page: ${width}x${height}pt, ${String(digest.orientation ?? "unknown")}, aspect ${String(digest.aspectRatio ?? "unknown")}`,
    );
  }

  const backgrounds = asArray(digest.backgroundColors)
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map(
      (entry) => `${String(entry.color)} (${String(entry.pageCount)} pages)`,
    );
  lines.push(
    backgrounds.length > 0
      ? `- Painted page backgrounds: ${backgrounds.join(", ")}`
      : "- Page backgrounds: plain paper, no painted fill",
  );

  const typeScale = asArray(digest.typeScale)
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  if (typeScale.length > 0) {
    lines.push("- Type scale, most used first:");
    for (const role of typeScale) {
      const parts = [`${String(role.fontSizePt)}pt`];
      if (role.fontFamily) parts.push(String(role.fontFamily));
      if (role.bold === true) parts.push("bold");
      if (role.color) parts.push(String(role.color));
      const sample = asString(role.sample);
      lines.push(
        `  - ${parts.join(" ")} — ${String(role.runCount)} runs${sample ? `, e.g. "${sample}"` : ""}`,
      );
    }
  }

  const margins = asRecord(digest.textMarginsPt);
  if (margins) {
    lines.push(
      `- Median text margins: ${String(margins.left)}pt left, ${String(margins.right)}pt right, ${String(margins.top)}pt top, ${String(margins.bottom)}pt bottom`,
    );
  }

  const alignments = asArray(digest.paragraphAlignments)
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => `${String(entry.alignment)} (${String(entry.blockCount)})`);
  if (alignments.length > 0) {
    lines.push(`- Paragraph alignment: ${alignments.join(", ")}`);
  }

  if (typeof digest.pagesWithImages === "number") {
    lines.push(
      `- Pages carrying imagery: ${digest.pagesWithImages} of ${String(digest.pageCount ?? "?")}`,
    );
  }

  return lines;
}

function describePdf(result: Record<string, unknown>): string[] {
  const lines = [...describeStyleDigest(result), "", "Extracted page text:"];
  const pages = asArray(result.pages)
    .map(asRecord)
    .filter((page): page is Record<string, unknown> => page !== null)
    .slice(0, MAX_PDF_PAGES_IN_CONTEXT);
  for (const page of pages) {
    const text = asString(page.text) ?? asString(page.textPreview);
    if (!text) continue;
    lines.push(`- Page ${String(page.pageNum ?? "?")}: ${text.trim()}`);
  }
  return lines;
}

function describePptx(result: Record<string, unknown>): ReferencePart[] {
  const lines: ReferencePart[] = [];
  const theme = asRecord(result.theme);
  if (theme) {
    const fonts = asArray(theme.fonts).filter(
      (font): font is string => typeof font === "string",
    );
    const colors = asArray(theme.colors).filter(
      (color): color is string => typeof color === "string",
    );
    lines.push("Measured visual language:");
    if (fonts.length > 0) lines.push(`- Theme fonts: ${fonts.join(", ")}`);
    if (colors.length > 0) lines.push(`- Theme colors: ${colors.join(", ")}`);
    lines.push("");
  }
  lines.push("Extracted slides:");
  if (typeof result.vectorSummaryNotice === "string") {
    lines.push(
      "Vector summaries describe only supported parsed shapes, not faithful images or complete slide coverage; the parser may omit unsupported content or incomplete custom geometry. A [truncated] marker means the reference is partial.",
    );
  }
  const allSlides = asArray(result.slides);
  const slides = allSlides
    .map(asRecord)
    .filter((slide): slide is Record<string, unknown> => slide !== null)
    .slice(0, MAX_PPTX_SLIDES_IN_CONTEXT);
  for (const slide of slides) {
    const texts = asString(slide.texts);
    const layout = asString(slide.layoutHint);
    const index = typeof slide.index === "number" ? slide.index : "?";
    lines.push(
      `- Slide ${index}${layout ? ` [${layout}]` : ""}: ${texts ?? "(no text)"}`,
    );
    if (Array.isArray(slide.vectorShapes)) {
      const width = slide.widthEmu;
      const height = slide.heightEmu;
      if (
        typeof width === "number" &&
        Number.isFinite(width) &&
        width > 0 &&
        typeof height === "number" &&
        Number.isFinite(height) &&
        height > 0
      ) {
        lines.push(
          `  Canvas: ${width} x ${height} EMU; shape coordinates and sizes are in EMU, order follows parsed slide elements.`,
        );
      } else {
        lines.push(
          "  Slide dimensions unavailable; shape coordinates are in EMU.",
        );
      }
      let invalid = 0;
      for (const value of slide.vectorShapes.slice(0, 100)) {
        const shape = pptxReferenceShapeSchema.safeParse(value);
        if (!shape.success) {
          invalid++;
          continue;
        }
        const serialized = serializePptxReferenceShape(shape.data);
        if (serialized.length > MAX_PPTX_SHAPE_CHARS) {
          invalid++;
          continue;
        }
        lines.push({ atomic: `  Vector: ${serialized}` });
      }
      const omitted =
        typeof slide.vectorShapesOmitted === "number" &&
        Number.isSafeInteger(slide.vectorShapesOmitted) &&
        slide.vectorShapesOmitted > 0
          ? slide.vectorShapesOmitted
          : 0;
      invalid += Math.max(0, slide.vectorShapes.length - 100);
      if (omitted + invalid > 0)
        lines.push(
          `  ${omitted + invalid} parsed vector shape(s) omitted due to limits or unsupported data.`,
        );
      if (typeof slide.imageCount === "number" && slide.imageCount > 0)
        lines.push(
          `  ${slide.imageCount} image(s) not represented by these vectors.`,
        );
      if (typeof slide.tablesDegraded === "number" && slide.tablesDegraded > 0)
        lines.push(
          `  ${slide.tablesDegraded} table(s) degraded during parsing.`,
        );
    }
  }
  return lines;
}

function describeDocx(result: Record<string, unknown>): string[] {
  const lines = ["Extracted sections:"];
  const sections = asArray(result.sections)
    .map(asRecord)
    .filter((section): section is Record<string, unknown> => section !== null)
    .slice(0, MAX_DOCX_SECTIONS_IN_CONTEXT);
  for (const section of sections) {
    const heading = asString(section.heading) ?? "(untitled section)";
    const preview = asString(section.textPreview) ?? "";
    lines.push(`- ${heading}: ${preview}`);
  }
  const text = asString(result.text);
  if (sections.length === 0 && text) {
    lines.push(`- Document text: ${text}`);
  }
  return lines;
}

export function hasMeasuredDesign(
  format: ReferenceDocumentFormat,
  result: Record<string, unknown>,
): boolean {
  if (format === "pdf") return asRecord(result.styleDigest) !== null;
  if (format === "pptx") {
    const theme = asRecord(result.theme);
    if (!theme) return false;
    return asArray(theme.fonts).length > 0 || asArray(theme.colors).length > 0;
  }
  return false;
}

function describePptxOmissions(
  result: Record<string, unknown>,
): string | undefined {
  let omitted = 0;
  let labelsTruncated = 0;
  for (const value of asArray(result.slides)) {
    const slide = asRecord(value);
    if (!slide) continue;
    if (
      typeof slide.vectorShapesOmitted === "number" &&
      Number.isSafeInteger(slide.vectorShapesOmitted) &&
      slide.vectorShapesOmitted > 0
    ) {
      omitted += slide.vectorShapesOmitted;
    }
    const shapes = asArray(slide.vectorShapes);
    omitted += Math.max(0, shapes.length - 100);
    for (const shape of shapes.slice(0, 100)) {
      const parsed = pptxReferenceShapeSchema.safeParse(shape);
      if (
        !parsed.success ||
        serializePptxReferenceShape(parsed.data).length > MAX_PPTX_SHAPE_CHARS
      )
        omitted++;
      else if (parsed.data.sourceTextTruncated) labelsTruncated++;
    }
  }
  const parts = [];
  if (omitted > 0) parts.push(`${omitted} parsed vector shape(s) omitted`);
  if (labelsTruncated > 0)
    parts.push(`${labelsTruncated} shape label(s) truncated`);
  const notices = parts.length
    ? [`PPTX vector summary is partial: ${parts.join("; ")}.`]
    : [];
  const slides = asArray(result.slides);
  const includedSlides = slides
    .filter((slide) => asRecord(slide) !== null)
    .slice(0, MAX_PPTX_SLIDES_IN_CONTEXT);
  if (slides.length > includedSlides.length)
    notices.push(
      `${slides.length - includedSlides.length} slide(s) omitted from this reference context.`,
    );
  if (
    typeof result.hiddenSlideCount === "number" &&
    Number.isSafeInteger(result.hiddenSlideCount) &&
    result.hiddenSlideCount > 0
  )
    notices.push(
      `${result.hiddenSlideCount} hidden slide(s) excluded by the parser.`,
    );
  return notices.length ? notices.join("\n") : undefined;
}

function describeReference(
  file: UploadedFile,
  format: ReferenceDocumentFormat,
  result: Record<string, unknown>,
): { block: ReferenceBlock; truncated: boolean } {
  const body =
    format === "pdf"
      ? describePdf(result)
      : format === "pptx"
        ? describePptx(result)
        : describeDocx(result);
  const block = referenceBlock([
    `### ${file.originalName} (${format.toUpperCase()})`,
    ...body,
  ]);
  return {
    block: truncate(block, MAX_CHARS_PER_REFERENCE),
    truncated: block.text.length > MAX_CHARS_PER_REFERENCE,
  };
}

function hasUsableContent(
  format: ReferenceDocumentFormat,
  result: Record<string, unknown>,
): boolean {
  if (format === "pdf") {
    const textPageCount = result.textPageCount;
    return typeof textPageCount === "number" && textPageCount > 0;
  }
  if (format === "pptx") {
    return asArray(result.slides).length > 0;
  }
  const textLength = result.textLength;
  return (
    asArray(result.sections).length > 0 ||
    (typeof textLength === "number" && textLength > 0)
  );
}

export interface HydrateReferenceDocumentsOptions {
  excludePaths?: Iterable<string>;
  callActionImpl?: typeof callAction;
  now?: () => number;
}

export async function hydrateReferenceDocuments(
  files: UploadedFile[],
  options: HydrateReferenceDocumentsOptions = {},
): Promise<ReferenceDocumentHydration> {
  const excluded = new Set(options.excludePaths ?? []);
  const call = options.callActionImpl ?? callAction;
  const now = options.now ?? (() => Date.now());
  const targets = files.flatMap((file) => {
    if (excluded.has(file.path)) return [];
    const format = referenceDocumentFormat(file);
    return format ? [{ file, format }] : [];
  });
  if (targets.length === 0) return { status: "none" };

  const deadlineAt = now() + REFERENCE_HYDRATION_DEADLINE_MS;
  const outcomes = new Array<ReferenceReadOutcome>(targets.length);
  let next = 0;

  const worker = async () => {
    for (let index = next++; index < targets.length; index = next++) {
      outcomes[index] = await readReference(
        targets[index],
        call,
        Math.min(REFERENCE_HYDRATION_TIMEOUT_MS, deadlineAt - now()),
      );
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(HYDRATION_CONCURRENCY, targets.length) },
      worker,
    ),
  );

  const failures = outcomes.flatMap((outcome) =>
    outcome.status === "failed"
      ? [{ originalName: outcome.originalName, message: outcome.message }]
      : [],
  );
  if (failures.length > 0) {
    return {
      status: "unreadable",
      failures,
      message: describeUnreadableReferences(failures),
    };
  }

  const prefix = [
    "",
    "## Attached Reference Documents",
    "These files were read before this run started. Their content and measured visual language below are the reference; do not re-read them with `import-file` unless a section below says the file was omitted for space, and do not generate as if they were missing.",
    "Match the reference's type scale, weights, colors, alignment, and margins when the user asked for a visual or style reference. Take structure and wording from the user's request, not from the reference's own page order.",
  ].join("\n\n");
  const reads = outcomes.filter(
    (outcome): outcome is Extract<ReferenceReadOutcome, { status: "read" }> =>
      outcome.status === "read",
  );
  const partialVisual =
    "PPTX visual data is partial: reference content was truncated.";
  const omittedBlock = (outcome: (typeof reads)[number]) =>
    [
      `### ${singleLine(outcome.originalName)}\nRead successfully, but omitted from this prompt because earlier references filled the reference budget. This file is the one exception to the no-reread rule above: call \`import-file\` for it if you need its content.`,
      outcome.omissions,
      outcome.format === "pptx" ? partialVisual : undefined,
    ]
      .filter(Boolean)
      .join("\n");
  const remainderNotice =
    "The rest of this reference was omitted for space; call `import-file` for this file if you need the remainder.";
  const entries = reads.map((outcome) => {
    const extra = [
      outcome.truncated ? remainderNotice : undefined,
      outcome.omissions,
      outcome.format === "pptx" && outcome.truncated
        ? partialVisual
        : undefined,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      outcome,
      fallback: omittedBlock(outcome),
      whole: [outcome.block.text, extra].filter(Boolean).join("\n"),
      futureSize: 0,
    };
  });
  let suffixSize = 0;
  for (const entry of [...entries].reverse()) {
    entry.futureSize = suffixSize;
    suffixSize += 2 + Math.min(entry.fallback.length, entry.whole.length);
  }
  const aggregateNotice = (count: number) =>
    `${count} reference file(s) omitted from this prompt because the reference budget was filled. Their content and PPTX omission details are unavailable here; call \`import-file\` for any omitted file needed.`;
  const aggregateReserve = 2 + aggregateNotice(reads.length).length;
  let remaining = MAX_TOTAL_REFERENCE_CHARS - prefix.length;
  const blocks: string[] = [];
  let measuredDesignCount = 0;
  for (const [index, entry] of entries.entries()) {
    const { outcome, fallback, futureSize, whole } = entry;
    const reserve =
      futureSize > MAX_TOTAL_REFERENCE_CHARS / 2
        ? aggregateReserve
        : futureSize;
    const available = remaining - 2 - reserve;
    const fitsWhole = whole.length <= available;
    if (fitsWhole) {
      blocks.push(whole);
      remaining -= 2 + whole.length;
      if (outcome.measuredDesign) measuredDesignCount++;
      continue;
    }
    if (fallback.length > available) {
      blocks.push(aggregateNotice(reads.length - index));
      break;
    }
    const partialNotice = [
      remainderNotice,
      outcome.omissions,
      outcome.format === "pptx" ? partialVisual : undefined,
    ]
      .filter(Boolean)
      .join("\n");
    const bodyBudget = available - 1 - partialNotice.length;
    const block =
      bodyBudget >= MIN_PARTIAL_REFERENCE_CHARS
        ? `${truncate(outcome.block, bodyBudget).text}\n${partialNotice}`
        : fallback;
    blocks.push(block);
    remaining -= 2 + block.length;
  }

  return {
    status: "hydrated",
    readCount: reads.length,
    measuredDesignCount,
    context: [prefix, ...blocks].join("\n\n"),
  };
}

type ReferenceReadOutcome =
  | {
      status: "read";
      originalName: string;
      format: ReferenceDocumentFormat;
      block: ReferenceBlock;
      truncated: boolean;
      omissions?: string;
      measuredDesign: boolean;
    }
  | { status: "failed"; originalName: string; message: string };

async function readReference(
  target: { file: UploadedFile; format: ReferenceDocumentFormat },
  call: typeof callAction,
  timeoutMs: number,
): Promise<ReferenceReadOutcome> {
  const { file, format } = target;
  if (timeoutMs <= 0) {
    return {
      status: "failed",
      originalName: file.originalName,
      message: "reading the attached references took too long",
    };
  }
  try {
    const result = asRecord(
      await call(
        "import-file",
        { filePath: file.path, format, maxChars: MAX_CHARS_PER_REFERENCE },
        { timeoutMs },
      ),
    );
    if (!result) {
      return {
        status: "failed",
        originalName: file.originalName,
        message: "the file reader returned no result",
      };
    }
    if (!hasUsableContent(format, result)) {
      return {
        status: "failed",
        originalName: file.originalName,
        message: "no readable content was found in the file",
      };
    }
    return {
      status: "read",
      originalName: file.originalName,
      format,
      ...describeReference(file, format, result),
      omissions: format === "pptx" ? describePptxOmissions(result) : undefined,
      measuredDesign: hasMeasuredDesign(format, result),
    };
  } catch (error) {
    return {
      status: "failed",
      originalName: file.originalName,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function describeUnreadableReferences(
  failures: ReferenceDocumentFailure[],
): string {
  const detail = failures
    .map((failure) => `"${failure.originalName}" (${failure.message})`)
    .join("; ");
  return `Slides could not read ${failures.length === 1 ? "the reference file" : "these reference files"} ${detail}. Generation was stopped so the deck does not get built without the reference. Re-upload the file and try again, or remove it to generate without it.`;
}
