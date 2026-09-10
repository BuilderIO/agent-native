import type { Document } from "@shared/api";

import type { DatabaseExportContext } from "./database/DatabaseExportDialog";
import { DatabaseView } from "./database/DatabaseView";

export * from "./database/DatabaseView";

interface DocumentDatabaseProps {
  document: Document;
  canEdit: boolean;
  viewId?: string | null;
  onExportContextChange?: (context: DatabaseExportContext | null) => void;
}

export function DocumentDatabase({
  document,
  canEdit,
  viewId,
  onExportContextChange,
}: DocumentDatabaseProps) {
  const databaseId = document.database?.id;
  if (!databaseId) return null;

  return (
    <DatabaseView
      databaseId={databaseId}
      databaseDocumentId={document.id}
      canEdit={canEdit}
      viewId={viewId}
      onExportContextChange={onExportContextChange}
    />
  );
}
