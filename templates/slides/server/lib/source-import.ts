export type SourceImportFormat = "pdf" | "pptx";

export interface SourceImportSlideSnapshot {
  id: string;
  text: string;
  notes: string;
  imageUrls: string[];
  editableText: boolean;
}

export interface SourceImportMetadata {
  mode: "source-preserving";
  format: SourceImportFormat;
  fidelity: "source-faithful" | "partial";
  importedAt: string;
  slideCount: number;
  slideIds: string[];
  slides: SourceImportSlideSnapshot[];
  imagesSkipped?: number;
}

export function buildSourceImportMetadata(args: {
  format: SourceImportFormat;
  importedAt?: string;
  slides: SourceImportSlideSnapshot[];
  imagesSkipped?: number;
}): SourceImportMetadata {
  const importedAt = args.importedAt ?? new Date().toISOString();
  const imagesSkipped = args.imagesSkipped ?? 0;
  return {
    mode: "source-preserving",
    format: args.format,
    fidelity: imagesSkipped > 0 ? "partial" : "source-faithful",
    importedAt,
    slideCount: args.slides.length,
    slideIds: args.slides.map((slide) => slide.id),
    slides: args.slides,
    ...(imagesSkipped > 0 ? { imagesSkipped } : {}),
  };
}

export function mergeSourceImportMetadata(
  existing: SourceImportMetadata | null,
  incoming: SourceImportMetadata,
): SourceImportMetadata {
  if (!existing) return incoming;
  if (existing.format !== incoming.format) {
    throw new Error(
      `Cannot append a ${incoming.format.toUpperCase()} source import to a ${existing.format.toUpperCase()} source-imported deck. Import matching source formats separately so every slide keeps its provenance.`,
    );
  }

  const slidesById = new Map<string, SourceImportSlideSnapshot>();
  for (const slide of existing.slides) slidesById.set(slide.id, slide);
  for (const slide of incoming.slides) slidesById.set(slide.id, slide);
  const slides = [...slidesById.values()];
  const imagesSkipped =
    (existing.imagesSkipped ?? 0) + (incoming.imagesSkipped ?? 0);

  return {
    ...incoming,
    fidelity:
      existing.fidelity === "partial" || incoming.fidelity === "partial"
        ? "partial"
        : "source-faithful",
    slideCount: slides.length,
    slideIds: slides.map((slide) => slide.id),
    slides,
    ...(imagesSkipped > 0 ? { imagesSkipped } : {}),
  };
}

export function sourceImportForDeck(
  value: unknown,
): SourceImportMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<SourceImportMetadata>;
  if (
    record.mode !== "source-preserving" ||
    (record.format !== "pdf" && record.format !== "pptx") ||
    !Array.isArray(record.slides)
  ) {
    return null;
  }
  return record as SourceImportMetadata;
}

function extractImageUrls(content: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const imagePattern = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  for (const match of content.matchAll(imagePattern)) {
    const url = match[1]
      ?.replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .trim();
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

function sourceWords(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9'-]{3,}/g)
      ?.map((word) => word.replace(/^['-]+|['-]+$/g, "")) ?? [],
  );
}

/**
 * Protects an imported deck from the common "make it prettier" failure mode:
 * the agent replaces a source slide with a generic card and silently drops the
 * original artwork or most of its factual copy. Explicit rewrite requests can
 * opt out with preserveSource=false.
 */
export function assertSourceSlidePreserved(args: {
  metadata: SourceImportMetadata | null;
  slideId: string;
  nextContent?: string;
  nextNotes?: string;
  preserveSource?: boolean;
}): void {
  if (args.preserveSource === false || !args.metadata) return;
  const snapshot = args.metadata.slides.find(
    (slide) => slide.id === args.slideId,
  );
  if (!snapshot) return;

  if (
    args.nextNotes !== undefined &&
    snapshot.notes.length > 0 &&
    args.nextNotes !== snapshot.notes
  ) {
    throw new Error(
      `Source-preserving edit would remove or change imported speaker notes on slide ${args.slideId}. Preserve the source notes, or pass preserveSource=false only when the user explicitly asks for a rewrite.`,
    );
  }

  if (args.nextContent === undefined) return;

  const nextImageUrls = new Set(extractImageUrls(args.nextContent));
  const missingImages = snapshot.imageUrls.filter(
    (url) => !nextImageUrls.has(url),
  );
  if (missingImages.length > 0) {
    throw new Error(
      `Source-preserving edit would remove ${missingImages.length} original image(s) from slide ${args.slideId}. Keep every existing source image, or pass preserveSource=false only when the user explicitly asks for a rewrite.`,
    );
  }

  if (!snapshot.editableText) return;
  const originalWords = sourceWords(snapshot.text);
  if (originalWords.size < 12) return;
  const nextWords = sourceWords(args.nextContent.replace(/<[^>]+>/g, " "));
  const retainedWords = [...originalWords].filter((word) =>
    nextWords.has(word),
  ).length;
  if (retainedWords / originalWords.size < 0.35) {
    throw new Error(
      `Source-preserving edit would drop most of the original factual copy from slide ${args.slideId}. Preserve the source text, or pass preserveSource=false only when the user explicitly asks for a rewrite.`,
    );
  }
}
