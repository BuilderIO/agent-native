import type { Document } from "@shared/api";
import { DatabaseView } from "./database/DatabaseView";

export * from "./database/DatabaseView";

interface DocumentDatabaseProps {
  document: Document;
  canEdit: boolean;
}

export function DocumentDatabase({ document, canEdit }: DocumentDatabaseProps) {
  if (!document.database) return null;

  return (
    <DatabaseView
      databaseId={document.database.id}
      databaseDocumentId={document.id}
      hostDocumentId={document.id}
      renderMode="page"
      canEdit={canEdit}
    />
  );
}
