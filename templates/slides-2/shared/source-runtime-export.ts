export type SourceRuntimeExportFormat = "html" | "pdf" | "pptx";

export const SOURCE_RUNTIME_EXPORT_ERROR_CODE =
  "source_runtime_export_required";
const MAX_REPORTED_SLIDE_IDS = 20;
const MAX_SLIDE_ID_LENGTH = 80;

export class SourceRuntimeExportError extends Error {
  readonly errorCode = SOURCE_RUNTIME_EXPORT_ERROR_CODE;
  readonly statusCode = 422;
  readonly format: SourceRuntimeExportFormat;
  readonly slideIds: string[];
  readonly slideCount: number;

  constructor(format: SourceRuntimeExportFormat, slideIds: string[]) {
    const reportedIds = slideIds
      .slice(0, MAX_REPORTED_SLIDE_IDS)
      .map((slideId) => slideId.slice(0, MAX_SLIDE_ID_LENGTH));
    const moreCount = slideIds.length - reportedIds.length;
    const labels = [
      ...reportedIds,
      ...(moreCount > 0 ? [`and ${moreCount} more`] : []),
    ];
    super(
      `Cannot export ${format.toUpperCase()}: ${slideIds.length === 1 ? "slide" : "slides"} ${labels.join(", ")} ${slideIds.length === 1 ? "requires" : "require"} React Worker rendering, which this export path does not provide. No file was created.`,
    );
    this.name = "SourceRuntimeExportError";
    this.format = format;
    this.slideIds = reportedIds;
    this.slideCount = slideIds.length;
  }
}

export function sourceRuntimeExportError(
  slides: unknown,
  format: SourceRuntimeExportFormat,
): SourceRuntimeExportError | null {
  if (!Array.isArray(slides)) return null;
  const slideIds = slides.flatMap((slide, index) => {
    if (!slide || typeof slide !== "object" || Array.isArray(slide)) {
      return [];
    }
    const value = slide as Record<string, unknown>;
    const runtimeRequired = value.sourceRuntimeRequired === true;
    const hasSource =
      typeof value.sourceTsx === "string" && Boolean(value.sourceTsx.trim());
    const needsWorker = runtimeRequired || hasSource;
    const hasStaticPreview =
      typeof value.content === "string" && Boolean(value.content.trim());
    if (!needsWorker || (!runtimeRequired && hasStaticPreview)) {
      return [];
    }
    return [
      typeof value.id === "string" && value.id.trim()
        ? value.id.trim()
        : `#${index + 1}`,
    ];
  });
  return slideIds.length
    ? new SourceRuntimeExportError(format, slideIds)
    : null;
}

export function isSourceRuntimeExportError(
  value: unknown,
): value is SourceRuntimeExportError {
  return (
    value instanceof SourceRuntimeExportError ||
    Boolean(
      value &&
      typeof value === "object" &&
      (value as { errorCode?: unknown }).errorCode ===
        SOURCE_RUNTIME_EXPORT_ERROR_CODE,
    )
  );
}
