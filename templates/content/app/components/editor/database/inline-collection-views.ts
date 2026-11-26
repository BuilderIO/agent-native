import type { DatabaseExportContext } from "./DatabaseExportDialog";

const shown = new Map<string, DatabaseExportContext>();

export function showInlineCollectionView(
  databaseDocumentId: string,
  view: DatabaseExportContext,
) {
  shown.set(databaseDocumentId, view);
  return () => {
    if (shown.get(databaseDocumentId) === view) {
      shown.delete(databaseDocumentId);
    }
  };
}

export function shownInlineCollectionView(databaseDocumentId: string) {
  return shown.get(databaseDocumentId) ?? null;
}
