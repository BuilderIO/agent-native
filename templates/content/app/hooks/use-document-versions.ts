import { useActionQuery } from "@agent-native/core/client/hooks";
import type { Document } from "@shared/api";
import type {
  DocumentHistoryChanges,
  DocumentHistoryCheckpointDetail,
  DocumentHistoryCheckpointPage,
  DocumentHistoryPage,
} from "@shared/document-history";
import { useQueryClient } from "@tanstack/react-query";

import {
  contentNavigationBranchFilter,
  contentNavigationContextFilter,
  SEARCH_QUERY_KEYS,
  useContentActionMutation,
  type ContentQueryTarget,
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

export function useDocumentHistoryChanges(
  documentId: string | null,
  groupId: string | null,
) {
  return useActionQuery<DocumentHistoryChanges>(
    "get-document-history-change",
    documentId && groupId ? { documentId, groupId } : undefined,
    { enabled: !!documentId && !!groupId },
  );
}

/** What undoing a History entry did; see `undo-document-change`. */
export type DocumentUndoOutcome =
  | "undone"
  | "partly-undone"
  | "nothing-undone"
  | "already-undone"
  | "replayed";

/** The page after an undo, and what the undo did. */
export type DocumentUndoResult = Document & {
  outcome: DocumentUndoOutcome;
  /** Set when the undo changed the page. */
  undoGroupId?: string;
  keptBack?: Array<{ changedTo: string; changedFrom: string }>;
};

// A restore or undo rewrites the page's body, so it can bring back or drop
// inline collections (child pages) and rewrites blocks-field values.
function historyWriteInvalidates(
  documentId: string,
): readonly ContentQueryTarget[] {
  return [
    documentQueryFilter(documentId),
    ["action", "list-document-history"],
    ["action", "list-document-history-checkpoints"],
    ["action", "get-document-history-checkpoint"],
    ["action", "get-document-history-change"],
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
    ...SEARCH_QUERY_KEYS,
  ];
}

function patchHistoryWrite(
  queryClient: ReturnType<typeof useQueryClient>,
  documentId: string,
  page: Document,
) {
  patchDocumentCaches(queryClient, documentId, {
    title: page.title,
    content: page.content,
    updatedAt: page.updatedAt,
    ...(page.revision !== undefined ? { revision: page.revision } : {}),
    ...(page.bodyRevision !== undefined
      ? { bodyRevision: page.bodyRevision }
      : {}),
    ...(page.contentHash !== undefined
      ? { contentHash: page.contentHash }
      : {}),
  });
  const renamedContentSpace = patchContentSpaceNameCaches(
    queryClient,
    documentId,
    page.title,
  );
  if (renamedContentSpace) {
    void queryClient.invalidateQueries({
      queryKey: ["action", "list-content-spaces"],
    });
  }
}

export function useUndoDocumentChange(documentId: string) {
  const queryClient = useQueryClient();
  return useContentActionMutation<
    DocumentUndoResult,
    { documentId: string; groupId: string; idempotencyKey: string }
  >("undo-document-change", {
    onSuccess: (result) => {
      if (result.undoGroupId)
        patchHistoryWrite(queryClient, documentId, result);
    },
    invalidates: historyWriteInvalidates(documentId),
  });
}

export function useRestoreDocumentVersion(documentId: string) {
  const queryClient = useQueryClient();
  return useContentActionMutation<
    Document,
    { documentId: string; versionId: string; expectedUpdatedAt: string }
  >("restore-document-version", {
    onSuccess: (restored) => {
      patchHistoryWrite(queryClient, documentId, restored);
    },
    invalidates: historyWriteInvalidates(documentId),
  });
}
