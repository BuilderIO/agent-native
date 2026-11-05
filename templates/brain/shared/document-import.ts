export type DocumentImportFormat = "markdown" | "text";

export const DOCUMENT_IMPORT_EXTENSIONS = [".md", ".markdown", ".txt"];

export function documentImportFormat(
  path: string,
): DocumentImportFormat | null {
  const extension = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "txt") return "text";
  return null;
}
