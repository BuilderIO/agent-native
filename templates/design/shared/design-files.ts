import { isBoardFile } from "./board-file.js";

export function normalizedDesignFileType(
  fileType: string,
): "html" | "css" | "jsx" | "asset" {
  return fileType === "css" ||
    fileType === "jsx" ||
    fileType === "asset" ||
    fileType === "html"
    ? fileType
    : "html";
}

export function isOverviewScreenFile(file: {
  filename: string;
  fileType?: string | null;
}): boolean {
  return (
    !isBoardFile(file.filename) &&
    normalizedDesignFileType(file.fileType ?? "html") === "html"
  );
}

export function getOverviewScreenFileIds(
  files: readonly {
    id: string;
    filename: string;
    fileType?: string | null;
  }[],
): string[] {
  return files.filter(isOverviewScreenFile).map((file) => file.id);
}
