import { useActionQuery } from "@agent-native/core/client/hooks";
import type { Document } from "@shared/api";
import type {
  DocumentHistoryCheckpointDetail,
  DocumentHistoryCheckpointPage,
  DocumentHistoryPage,
} from "@shared/document-history";
import { useQueryClient } from "@tanstack/react-query";

import {
  contentNavigationBranchFilter,
  contentNavigationContextFilter,
  useContentActionMutation,
} from "./use-content-action-mutation";
import { contentDatabaseConstrainedQueryFilter } from "./use-content-database";
import {
  documentQueryFilter,
  patchDocumentCaches,
  patchContentSpaceNameCaches,
} from "./use-documents";

const HISTORY_PAGE_SIZE = 30;

export function useDocumentHistoryPage(
  documentId: string | null,
  cursor: string | null,
) {
  return useActionQuery<DocumentHistoryPage>(
    "list-document-history",
    documentId
      ? {
          documentId,
          limit: HISTORY_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        }
      : undefined,
    {
      enabled: !!documentId,
      placeholderData: (previous) => previous,
      staleTime: 0,
      refetchOnMount: "always",
    },
  );
}

export function useDocumentHistoryCheckpoints(
  documentId: string | null,
  groupId: string | null,
  cursor: string | null,
) {
  return useActionQuery<DocumentHistoryCheckpointPage>(
    "list-document-history-checkpoints",
    documentId && groupId
      ? {
          documentId,
          groupId,
          limit: 50,
          ...(cursor ? { cursor } : {}),
        }
      : undefined,
    {
      enabled: !!documentId && !!groupId,
      placeholderData: (previous) => previous,
      staleTime: 0,
      refetchOnMount: "always",
    },
  );
}

export function useDocumentHistoryCheckpoint(
  documentId: string | null,
  versionId: string | null,
) {
  return useActionQuery<{ checkpoint: DocumentHistoryCheckpointDetail }>(
    "get-document-history-checkpoint",
    documentId && versionId ? { documentId, versionId } : undefined,
    { enabled: !!documentId && !!versionId },
  );
}

export function useRestoreDocumentVersion(documentId: string) {
  const queryClient = useQueryClient();
  return useContentActionMutation<
    Document,
    { documentId: string; versionId: string; expectedUpdatedAt: string }
  >("restore-document-version", {
    onSuccess: (restored) => {
      patchDocumentCaches(queryClient, documentId, {
        title: restored.title,
        content: restored.content,
        updatedAt: restored.updatedAt,
        revision: restored.revision,
        bodyRevision: restored.bodyRevision,
        contentHash: restored.contentHash,
      });
      const renamedContentSpace = patchContentSpaceNameCaches(
        queryClient,
        documentId,
        restored.title,
      );
      if (renamedContentSpace) {
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-content-spaces"],
        });
      }
    },
    // A restored body can bring back or drop inline collections (child
    // pages) and rewrites blocks-field values.
    invalidates: [
      documentQueryFilter(documentId),
      ["action", "list-document-history"],
      ["action", "list-document-history-checkpoints"],
      ["action", "get-document-history-checkpoint"],
      ["action", "get-content-database"],
      contentDatabaseConstrainedQueryFilter(),
      contentNavigationBranchFilter({
        documentIds: [documentId],
        parentIds: [documentId],
      }),
      contentNavigationContextFilter([documentId]),
      ["action", "list-document-properties"],
      ["action", "list-content-databases"],
      ["action", "list-trashed-content-databases"],
      ["action", "list-documents"],
    ],
  });
}
