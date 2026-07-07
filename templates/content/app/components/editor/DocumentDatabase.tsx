import type { Document } from "@shared/api";

import { DatabaseView } from "./database/DatabaseView";

export * from "./database/DatabaseView";

interface DocumentDatabaseProps {
  document: Document;
  canEdit: boolean;
}

export function DocumentDatabase({ document, canEdit }: DocumentDatabaseProps) {
  const databaseId = document.database?.id;
  if (!databaseId) return null;

  return (
    <DatabaseView
      databaseId={databaseId}
      databaseDocumentId={document.id}
      canEdit={canEdit}
      documentOverride={document}
    />
  );
}
