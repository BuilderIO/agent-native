import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import type { Document } from "@shared/api";
import type {
  DocumentHistoryCheckpointDetail,
  DocumentHistoryCheckpointPage,
  DocumentHistoryPage,
} from "@shared/document-history";
import { useQueryClient } from "@tanstack/react-query";

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
  return useActionMutation<
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
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-document-history"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-document-history-checkpoints"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-document-history-checkpoint"],
      });
      void queryClient.invalidateQueries(documentQueryFilter(documentId));
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["action", "query-content-database-items"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-content-databases"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-trashed-content-databases"],
      });
      if (renamedContentSpace) {
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-content-spaces"],
        });
      }
    },
  });
}
