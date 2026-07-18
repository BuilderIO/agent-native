import { useT } from "@agent-native/core/client";
import type { Document } from "@shared/api";

import { DescriptionField } from "./DescriptionField";
import { DocumentProperties } from "./DocumentProperties";

interface DocumentInfoPanelProps {
  document: Document;
  canEdit: boolean;
  onSaveDescription: (description: string) => Promise<unknown> | unknown;
}

export function DocumentInfoPanel({
  document,
  canEdit,
  onSaveDescription,
}: DocumentInfoPanelProps) {
  const t = useT();
  const isLocalFileDocument = document.source?.mode === "local-files";

  return (
    <div className="px-4 pb-8 pt-3" data-document-info-panel>
      <DescriptionField
        description={document.description}
        canEdit={canEdit}
        label={t("editor.properties.description")}
        placeholder={
          document.database
            ? t("editor.properties.addDatabaseDescription")
            : t("editor.properties.addPageDescription")
        }
        onSave={onSaveDescription}
      />
      {document.databaseMembership && !isLocalFileDocument ? (
        <DocumentProperties documentId={document.id} canEdit={canEdit} />
      ) : null}
    </div>
  );
}
