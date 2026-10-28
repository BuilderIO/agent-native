import type { Document } from "@shared/api";

import type { DatabaseExportContext } from "./database/DatabaseExportDialog";
import { DatabaseView } from "./database/DatabaseView";
import { documentDatabaseWidgetEditProps } from "./database/scoped-row-write";

export * from "./database/DatabaseView";

interface DocumentDatabaseProps {
  document: Document;
  canEdit: boolean;
  canEditRowsOnly?: boolean;
  viewId?: string | null;
  foreground?: boolean;
  onExportContextChange?: (context: DatabaseExportContext | null) => void;
}

export function DocumentDatabase({
  document,
  canEdit,
  canEditRowsOnly = false,
  viewId,
  foreground,
  onExportContextChange,
}: DocumentDatabaseProps) {
  const databaseId = document.database?.id;
  if (!databaseId) return null;

  const widgetEditProps = documentDatabaseWidgetEditProps(
    document,
    canEdit,
    canEditRowsOnly,
  );

  return (
    <DatabaseView
      databaseId={databaseId}
      databaseDocumentId={document.id}
      canEdit={widgetEditProps.canEdit}
      canEditRows={widgetEditProps.canEditRows}
      viewId={viewId}
      foreground={foreground}
      onExportContextChange={onExportContextChange}
    />
  );
}
