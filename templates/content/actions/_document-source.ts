import type { DocumentSourceInfo } from "../shared/api.js";

interface DocumentSourceColumns {
  sourceMode?: string | null;
  sourceKind?: string | null;
  sourcePath?: string | null;
  sourceAbsolutePath?: string | null;
  sourceRootPath?: string | null;
  sourceUpdatedAt?: string | null;
}

export function serializeDocumentSource(
  document: DocumentSourceColumns,
): DocumentSourceInfo | undefined {
  if (
    document.sourceMode !== "database" &&
    document.sourceMode !== "local-files"
  ) {
    return undefined;
  }

  return {
    mode: document.sourceMode,
    kind: document.sourceKind ?? undefined,
    path: document.sourcePath ?? undefined,
    absolutePath: document.sourceAbsolutePath ?? undefined,
    rootPath: document.sourceRootPath ?? undefined,
    updatedAt: document.sourceUpdatedAt ?? undefined,
  };
}
