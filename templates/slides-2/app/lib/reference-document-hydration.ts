import { callAction } from "@agent-native/core/client/hooks";

import type { UploadedFile } from "@/components/editor/PromptDialog";

export const REFERENCE_HYDRATION_TIMEOUT_MS = 3 * 60 * 1000;

export const REFERENCE_HYDRATION_DEADLINE_MS = 4 * 60 * 1000;

const HYDRATION_CONCURRENCY = 3;

const MAX_CHARS_PER_REFERENCE = 12_000;
const MAX_TOTAL_REFERENCE_CHARS = 36_000;
const MIN_PARTIAL_REFERENCE_CHARS = 600;
const MAX_PDF_PAGES_IN_CONTEXT = 20;
const MAX_PPTX_SLIDES_IN_CONTEXT = 20;
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

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars).trimEnd()}\n[truncated]`;
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

function describePptx(result: Record<string, unknown>): string[] {
  const lines: string[] = [];
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
  const slides = asArray(result.slides)
    .map(asRecord)
    .filter((slide): slide is Record<string, unknown> => slide !== null)
    .slice(0, MAX_PPTX_SLIDES_IN_CONTEXT);
  for (const slide of slides) {
    const texts = asString(slide.texts);
    const layout = asString(slide.layoutHint);
    lines.push(
      `- Slide ${String(slide.index ?? "?")}${layout ? ` [${layout}]` : ""}: ${texts ?? "(no text)"}`,
    );
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
    lines.push(text);
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

function describeReference(
  file: UploadedFile,
  format: ReferenceDocumentFormat,
  result: Record<string, unknown>,
): string {
  const body =
    format === "pdf"
      ? describePdf(result)
      : format === "pptx"
        ? describePptx(result)
        : describeDocx(result);
  return truncate(
    [`### ${file.originalName} (${format.toUpperCase()})`, ...body].join("\n"),
    MAX_CHARS_PER_REFERENCE,
  );
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

  const budget = { remaining: MAX_TOTAL_REFERENCE_CHARS };
  const blocks: string[] = [];
  let measuredDesignCount = 0;
  for (const outcome of outcomes) {
    if (outcome.status !== "read") continue;
    const fitsWhole = outcome.block.length <= budget.remaining;
    if (!fitsWhole && budget.remaining < MIN_PARTIAL_REFERENCE_CHARS) {
      blocks.push(
        `### ${outcome.originalName}\nRead successfully, but omitted from this prompt because earlier references filled the reference budget. This file is the one exception to the no-reread rule above: call \`import-file\` for it if you need its content.`,
      );
      continue;
    }
    const block = truncate(outcome.block, budget.remaining);
    budget.remaining -= block.length;
    blocks.push(
      fitsWhole
        ? block
        : `${block}\nThe rest of this reference was omitted for space; call \`import-file\` for this file if you need the remainder.`,
    );
    if (outcome.measuredDesign && fitsWhole) measuredDesignCount += 1;
  }

  return {
    status: "hydrated",
    readCount: blocks.length,
    measuredDesignCount,
    context: [
      "",
      "## Attached Reference Documents",
      "These files were read before this run started. Their content and measured visual language below are the reference; do not re-read them with `import-file` unless a section below says the file was omitted for space, and do not generate as if they were missing.",
      "Match the reference's type scale, weights, colors, alignment, and margins when the user asked for a visual or style reference. Take structure and wording from the user's request, not from the reference's own page order.",
      ...blocks,
    ].join("\n\n"),
  };
}

type ReferenceReadOutcome =
  | {
      status: "read";
      originalName: string;
      block: string;
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
      block: describeReference(file, format, result),
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
