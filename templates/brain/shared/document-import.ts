export type DocumentImportFormat = "markdown" | "text" | "pdf" | "docx";

export const MAX_DOCUMENT_IMPORT_FILE_CHARS = 250_000;
export const MAX_DOCUMENT_IMPORT_FILE_BYTES = 25 * 1024 * 1024;

export function documentImportFormat(
  path: string,
): DocumentImportFormat | null {
  const extension = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  switch (extension) {
    case "md":
    case "markdown":
      return "markdown";
    case "txt":
      return "text";
    case "pdf":
      return "pdf";
    case "docx":
      return "docx";
    default:
      return null;
  }
}
