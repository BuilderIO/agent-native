import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useQueryClient } from "@tanstack/react-query";

import { TrashDocumentPreview } from "@/components/editor/TrashDocumentPreview";
import type { TrashPreviewLabels } from "@/components/editor/TrashDocumentPreview";

import { TrashRecoveryActions } from "./TrashRecoveryActions";

export function TrashRecoveryPreview({
  documentId,
  databaseId,
  databaseDocumentId,
}: {
  documentId: string;
  databaseId?: string | null;
  databaseDocumentId?: string | null;
}) {
  const t = useT();
  const { formatDate } = useFormatters();
  const queryClient = useQueryClient();
  const labels: TrashPreviewLabels = {
    readOnly: t("trashPreview.readOnly"),
    unavailable: t("trashPreview.unavailable"),
    properties: t("trashPreview.properties"),
    comments: t("trashPreview.comments"),
    history: t("trashPreview.history"),
    moreComments: t("trashPreview.moreComments"),
    moreHistory: t("trashPreview.moreHistory"),
    computedUnavailable: t("trashPreview.computedUnavailable"),
    previous: t("trashPreview.previous"),
    next: t("trashPreview.next"),
    unsupported: t("trashPreview.unsupported"),
    retry: t("trashPreview.retry"),
  };
  return (
    <TrashDocumentPreview
      documentId={documentId}
      databaseId={databaseId ?? undefined}
      databaseDocumentId={databaseDocumentId ?? undefined}
      labels={labels}
      actions={(document) => (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {document.trashedAt &&
              formatDate(document.trashedAt, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            {" · "}
            {document.trashedBy ?? t("trashBrowser.unknownActor")}
          </span>
          {(document.canRestore || document.canPermanentlyDelete) && (
            <TrashRecoveryActions
              items={[
                {
                  documentId: document.id,
                  databaseId:
                    document.kind === "database"
                      ? (document.database?.id ?? null)
                      : null,
                  title: document.title,
                  kind: document.kind,
                  trashedAt: document.trashedAt!,
                  trashedBy: document.trashedBy,
                  trashOrigin: document.trashOrigin,
                  trashRootId: null,
                  parentId: null,
                  parentTitle: null,
                  spaceId: null,
                  spaceName: null,
                  canRestore: document.canRestore,
                  canPermanentlyDelete: document.canPermanentlyDelete,
                  legacyRestoreDatabaseId: document.legacyRestoreDatabaseId,
                },
              ]}
              onComplete={() => {
                void queryClient.invalidateQueries({ queryKey: ["action"] });
              }}
            />
          )}
        </div>
      )}
    />
  );
}
