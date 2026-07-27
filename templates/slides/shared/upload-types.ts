export const SLIDES_REFERENCE_FILE_EXTENSIONS = [
  ".pptx",
  ".docx",
  ".pdf",
  ".fig",
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
  ".svg",
] as const;

export const SLIDES_REFERENCE_FILE_ACCEPT =
  SLIDES_REFERENCE_FILE_EXTENSIONS.join(",");

export const SLIDES_REFERENCE_FILE_LABEL =
  "PPTX, DOCX, PDF, FIG, text, Markdown, JSON, CSV, and images including SVG";

export const SLIDES_REFERENCE_FILE_ERROR_LABEL =
  "pptx, docx, pdf, fig, text, Markdown, JSON, CSV, and images including SVG";

export function isSlidesReferenceFileExtension(ext: string): boolean {
  return SLIDES_REFERENCE_FILE_EXTENSIONS.includes(
    ext.toLowerCase() as (typeof SLIDES_REFERENCE_FILE_EXTENSIONS)[number],
  );
}
