export const SLIDES_REFERENCE_FILE_EXTENSIONS = [
  ".pptx",
  ".docx",
  ".pdf",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
] as const;

export const SLIDES_REFERENCE_FILE_ACCEPT =
  SLIDES_REFERENCE_FILE_EXTENSIONS.join(",");

export const SLIDES_REFERENCE_FILE_LABEL =
  "PPTX, DOCX, PDF, text, Markdown, JSON, CSV, and images";

export const SLIDES_REFERENCE_FILE_ERROR_LABEL =
  "pptx, docx, pdf, text, Markdown, JSON, CSV, and raster images";

export function isSlidesReferenceFileExtension(ext: string): boolean {
  return SLIDES_REFERENCE_FILE_EXTENSIONS.includes(
    ext.toLowerCase() as (typeof SLIDES_REFERENCE_FILE_EXTENSIONS)[number],
  );
}
