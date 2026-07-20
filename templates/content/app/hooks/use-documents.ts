import {
  useActionQuery,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import type {
  ContentDatabaseResponse,
  ContentDatabaseItem,
  Document,
  DocumentCreateRequest,
  DocumentPropertiesResponse,
  DocumentUpdateRequest,
  DocumentUpdateResponse,
  DocumentMoveRequest,
  DocumentTreeNode,
} from "@shared/api";
import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { databaseItemBodyHydrationIsPending } from "@/components/editor/body-hydration";
import { isEffectivelyEmptyDocumentContent } from "@/components/editor/body-hydration";

import type { DocumentUpdateConflictResponse } from "../../actions/update-document";
import {
  removeOptimisticItemFromContentDatabase,
  useRestoreContentDatabase,
} from "./use-content-database";

export type { DocumentUpdateConflictResponse };

export const LIST_DOCUMENTS_QUERY_KEY = [
  "action",
  "list-documents",
  undefined,
] as const;

export function documentQueryKey(documentId: string) {
  return ["action", "get-document", { id: documentId }] as const;
}

export function documentPropertiesQueryKey(documentId: string) {
  return ["action", "list-document-properties", { documentId }] as const;
}

// Extends the shared request/response shapes with the optional
// compare-and-swap fields the action supports but shared/api.ts does not
// (yet) declare. See actions/update-document.ts for the CAS contract.
export type DocumentUpdateRequestWithCas = DocumentUpdateRequest & {
  id: string;
  /** updatedAt of the snapshot this save is based on; enables CAS for content saves. */
  baseUpdatedAt?: string;
};

export type DocumentUpdateResult =
  | DocumentUpdateResponse
  | DocumentUpdateConflictResponse;

// Accepts anything `persistDocumentUpdates`/`updateDocument.mutateAsync` can
// resolve with — including a bare `Document` from the local-file-source
// fallback path, which never CAS-conflicts but shares this call site's
// narrowing.
export function isDocumentUpdateConflict(
  result: Document | DocumentUpdateResult,
): result is DocumentUpdateConflictResponse {
  return (result as DocumentUpdateConflictResponse)?.conflict === true;
}

export function mergeDocumentIntoDocumentCache(
  old: unknown,
  document: Document,
) {
  return old && typeof old === "object" ? { ...old, ...document } : document;
}

export function mergeDocumentIntoListDocumentsCache(
  old: unknown,
  document: Document,
) {
  return patchDocumentInListDocumentsCache(old, document.id, document);
}

export function patchDocumentInListDocumentsCache(
  old: unknown,
  documentId: string,
  patch: Partial<Document>,
) {
  if (Array.isArray(old)) {
    return old.map((item: Document) =>
      item.id === documentId ? { ...item, ...patch } : item,
    );
  }

  if (!old || typeof old !== "object") return old;
  const cached = old as { documents?: unknown };
  if (!Array.isArray(cached.documents)) return old;

  const nextDocuments = cached.documents.map((item: Document) =>
    item.id === documentId ? { ...item, ...patch } : item,
  );

  return { ...(old as object), documents: nextDocuments };
}

export function setDocumentFavoriteInListCache(
  old: unknown,
  documentId: string,
  isFavorite: boolean,
) {
  return patchDocumentInListDocumentsCache(old, documentId, { isFavorite });
}

export function patchDocumentInDatabaseCache(
  current: ContentDatabaseResponse | undefined,
  documentId: string,
  patch: Partial<Document>,
): ContentDatabaseResponse | undefined {
  if (!current) return current;
  let changed = false;
  const items = current.items.map((item) => {
    if (item.document.id !== documentId) return item;
    changed = true;
    return {
      ...item,
      document: { ...item.document, ...patch },
    };
  });
  return changed ? { ...current, items } : current;
}

export function setDocumentFavoriteInDatabaseCache(
  current: ContentDatabaseResponse | undefined,
  documentId: string,
  isFavorite: boolean,
): ContentDatabaseResponse | undefined {
  if (current?.database?.systemRole === "favorites" && !isFavorite) {
    return removeOptimisticItemFromContentDatabase(current, documentId);
  }
  return patchDocumentInDatabaseCache(current, documentId, { isFavorite });
}

function patchDocumentWithFavoriteMembershipInDatabaseCache(
  current: ContentDatabaseResponse | undefined,
  documentId: string,
  patch: Partial<Document>,
): ContentDatabaseResponse | undefined {
  const patched = patchDocumentInDatabaseCache(current, documentId, patch);
  return patch.isFavorite === undefined
    ? patched
    : setDocumentFavoriteInDatabaseCache(patched, documentId, patch.isFavorite);
}

export function patchDocumentCaches(
  queryClient: Pick<QueryClient, "setQueryData" | "setQueriesData">,
  documentId: string,
  patch: Partial<Document>,
) {
  queryClient.setQueryData(documentQueryKey(documentId), (old: unknown) =>
    old && typeof old === "object" ? { ...old, ...patch } : old,
  );
  queryClient.setQueryData(LIST_DOCUMENTS_QUERY_KEY, (old: unknown) =>
    patchDocumentInListDocumentsCache(old, documentId, patch),
  );
  queryClient.setQueriesData<ContentDatabaseResponse>(
    { queryKey: ["action", "get-content-database"] },
    (current) =>
      patchDocumentWithFavoriteMembershipInDatabaseCache(
        current,
        documentId,
        patch,
      ),
  );
}

type ContentSpaceNameCache = {
  spaces?: Array<{
    name: string;
    filesDocumentId: string;
    catalogDocumentId: string;
  }>;
};

export function patchContentSpaceNameCaches(
  queryClient: Pick<QueryClient, "setQueriesData"> &
    Parameters<typeof patchDocumentCaches>[0],
  filesDocumentId: string,
  name: string,
) {
  const catalogDocumentIds = new Set<string>();
  let matched = false;

  queryClient.setQueriesData<ContentSpaceNameCache>(
    { queryKey: ["action", "list-content-spaces"] },
    (current) => {
      if (!current?.spaces) return current;
      let cacheMatched = false;
      const spaces = current.spaces.map((space) => {
        if (space.filesDocumentId !== filesDocumentId) return space;
        matched = true;
        cacheMatched = true;
        catalogDocumentIds.add(space.catalogDocumentId);
        return { ...space, name };
      });
      return cacheMatched ? { ...current, spaces } : current;
    },
  );

  for (const catalogDocumentId of catalogDocumentIds) {
    patchDocumentCaches(queryClient, catalogDocumentId, { title: name });
  }

  return matched;
}

export function documentUpdateSuccessPatch(
  data: DocumentUpdateResponse,
  variables: DocumentUpdateRequestWithCas,
): Partial<Document> {
  return {
    updatedAt: data.updatedAt,
    ...(variables.title !== undefined ? { title: data.title } : {}),
    ...(variables.content !== undefined ? { content: data.content } : {}),
    ...(variables.description !== undefined
      ? { description: data.description }
      : {}),
    ...(variables.icon !== undefined ? { icon: data.icon } : {}),
    ...(variables.isFavorite !== undefined
      ? { isFavorite: data.isFavorite }
      : {}),
  };
}

export function restoreQuerySnapshots(
  queryClient: Pick<QueryClient, "setQueryData">,
  snapshots: Array<[readonly unknown[], unknown]>,
) {
  for (const [queryKey, data] of snapshots) {
    queryClient.setQueryData(queryKey, data);
  }
}

export function seedDatabaseItemDocumentCaches(
  queryClient: Pick<QueryClient, "getQueryData" | "setQueryData">,
  item: ContentDatabaseItem,
) {
  const sourceBackedEmptyBody =
    (!!item.bodyHydration || !!item.document.databaseMembership?.sourceId) &&
    isEffectivelyEmptyDocumentContent(item.document.content);
  // Seed only cold caches. Overwriting an existing entry would bump its
  // freshness with possibly older table-snapshot data (a background database
  // refetch can lag a just-saved document edit) and suppress the correcting
  // refetch for the whole staleTime window. Source-backed rows are never seeded:
  // list snapshots are not authoritative enough to unlock the body editor, even
  // when they happen to contain non-empty content. The dedicated get-document
  // response owns that decision and prevents an edit from racing hydration.
  if (
    !databaseItemBodyHydrationIsPending(item) &&
    !sourceBackedEmptyBody &&
    !item.bodyHydration &&
    !item.document.databaseMembership?.sourceId &&
    queryClient.getQueryData(documentQueryKey(item.document.id)) === undefined
  ) {
    queryClient.setQueryData<Document>(documentQueryKey(item.document.id), {
      ...item.document,
      properties: item.properties,
    });
  }
  if (
    queryClient.getQueryData(documentPropertiesQueryKey(item.document.id)) ===
    undefined
  ) {
    queryClient.setQueryData<DocumentPropertiesResponse>(
      documentPropertiesQueryKey(item.document.id),
      {
        documentId: item.document.id,
        databaseId: item.databaseId,
        properties: item.properties,
      },
    );
  }
}

export function useDocuments() {
  return useActionQuery<Document[]>("list-documents", undefined, {
    select: (data: any) => {
      const docs = data?.documents ?? data;
      return Array.isArray(docs) ? docs : [];
    },
  });
}

export function useDocument(id: string | null) {
  return useActionQuery<Document>("get-document", id ? { id } : undefined, {
    enabled: !!id,
    // Doc-not-found / no-access errors are deterministic — retrying just keeps
    // the spinner up for ~7s before the UI can render "Not found".
    retry: false,
  });
}

export interface PreviewDocumentDraftRecord {
  documentId: string;
  title: string;
  content: string;
  baseDocumentUpdatedAt: string | null;
  loadedContentWasEmpty: number;
  deferredReason: string | null;
  version: number;
  updatedAt: string;
}

export function usePreviewDocumentDraft(documentId: string | null) {
  return useActionQuery<{ draft: PreviewDocumentDraftRecord | null }>(
    "get-preview-document-draft",
    documentId ? { documentId } : undefined,
    { enabled: !!documentId, retry: false },
  );
}

export function useUpdatePreviewDocumentDraft() {
  return useActionMutation<
    {
      status: "saved" | "deleted" | "conflict";
      draft: PreviewDocumentDraftRecord | null;
    },
    | {
        operation: "upsert";
        documentId: string;
        expectedVersion: number | null;
        draft: {
          title: string;
          content: string;
          baseDocumentUpdatedAt: string | null;
          loadedContentWasEmpty: boolean;
          deferredReason: "hydration" | "conflict" | null;
        };
      }
    | {
        operation: "delete";
        documentId: string;
        expectedVersion: number;
        expectedTitle: string;
        expectedContent: string;
      }
  >("update-preview-document-draft");
}

export function useCreateDocument() {
  return useActionMutation<Document, DocumentCreateRequest>("create-document");
}

export function useUpdateDocument() {
  const queryClient = useQueryClient();
  const restoreContentDatabase = useRestoreContentDatabase();
  return useActionMutation<DocumentUpdateResult, DocumentUpdateRequestWithCas>(
    "update-document",
    {
      skipActionQueryInvalidation: true,
      onMutate: async (variables) => {
        const optimisticPatch: Partial<Document> = {
          ...(variables.title !== undefined ? { title: variables.title } : {}),
          ...(variables.icon !== undefined ? { icon: variables.icon } : {}),
          ...(variables.isFavorite !== undefined
            ? { isFavorite: variables.isFavorite }
            : {}),
        };
        if (Object.keys(optimisticPatch).length === 0) return undefined;

        const documentKey = documentQueryKey(variables.id);
        const databaseFilter = {
          queryKey: ["action", "get-content-database"],
        } as const;
        const contentSpacesFilter = {
          queryKey: ["action", "list-content-spaces"],
        } as const;
        await Promise.all([
          queryClient.cancelQueries({ queryKey: documentKey }),
          queryClient.cancelQueries({ queryKey: LIST_DOCUMENTS_QUERY_KEY }),
          queryClient.cancelQueries(databaseFilter),
          queryClient.cancelQueries(contentSpacesFilter),
        ]);

        const previous: Array<[readonly unknown[], unknown]> = [
          [documentKey, queryClient.getQueryData(documentKey)],
          [
            LIST_DOCUMENTS_QUERY_KEY,
            queryClient.getQueryData(LIST_DOCUMENTS_QUERY_KEY),
          ],
          ...queryClient.getQueriesData<ContentDatabaseResponse>(
            databaseFilter,
          ),
          ...queryClient.getQueriesData(contentSpacesFilter),
        ];

        patchDocumentCaches(queryClient, variables.id, optimisticPatch);
        const renamedContentSpace =
          variables.title !== undefined
            ? patchContentSpaceNameCaches(
                queryClient,
                variables.id,
                variables.title,
              )
            : false;

        return { previous, renamedContentSpace };
      },
      onError: (_error, variables, context) => {
        const rollback = context as
          | { previous?: Array<[readonly unknown[], unknown]> }
          | undefined;
        restoreQuerySnapshots(queryClient, rollback?.previous ?? []);
      },
      onSuccess: (data, variables, context) => {
        const renamedContentSpace = (
          context as { renamedContentSpace?: boolean } | undefined
        )?.renamedContentSpace;
        // A CAS conflict is a normal (non-thrown) result, not a successful
        // save — converge the caches to the returned server document (so the
        // UI immediately reflects the write that actually won) but skip the
        // save-specific side effects below, which assume `data` describes the
        // just-applied write.
        if (isDocumentUpdateConflict(data)) {
          const serverDocument = data.document;
          queryClient.setQueryData(
            ["action", "get-document", { id: variables.id }],
            (old: unknown) =>
              mergeDocumentIntoDocumentCache(old, serverDocument),
          );
          queryClient.setQueryData(LIST_DOCUMENTS_QUERY_KEY, (old: unknown) =>
            mergeDocumentIntoListDocumentsCache(old, serverDocument),
          );
          queryClient.setQueriesData<ContentDatabaseResponse>(
            { queryKey: ["action", "get-content-database"] },
            (current) =>
              patchDocumentWithFavoriteMembershipInDatabaseCache(
                current,
                variables.id,
                serverDocument,
              ),
          );
          if (renamedContentSpace) {
            patchContentSpaceNameCaches(
              queryClient,
              variables.id,
              serverDocument.title,
            );
            queryClient.invalidateQueries({
              queryKey: ["action", "list-content-spaces"],
            });
            queryClient.invalidateQueries({
              queryKey: ["action", "get-content-database"],
            });
          }
          queryClient.invalidateQueries({
            queryKey: ["action", "get-document", { id: variables.id }],
          });
          queryClient.invalidateQueries({
            queryKey: ["action", "list-documents"],
          });
          return;
        }

        patchDocumentCaches(
          queryClient,
          variables.id,
          documentUpdateSuccessPatch(data, variables),
        );
        if (renamedContentSpace) {
          patchContentSpaceNameCaches(queryClient, variables.id, data.title);
          queryClient.invalidateQueries({
            queryKey: ["action", "list-content-spaces"],
          });
          queryClient.invalidateQueries({
            queryKey: ["action", "get-content-database"],
          });
        }
        if (variables.isFavorite !== undefined) {
          queryClient.invalidateQueries({
            queryKey: ["action", "get-content-database"],
          });
        }

        if (data.softDeletedDatabaseIds.length > 0) {
          queryClient.invalidateQueries({
            queryKey: ["action", "get-content-database"],
          });
          queryClient.invalidateQueries({
            queryKey: ["action", "list-trashed-content-databases"],
          });
          const databaseIds = data.softDeletedDatabaseIds;
          toast("Database deleted", {
            action: {
              label: "Undo",
              onClick: () => {
                void Promise.all(
                  databaseIds.map((databaseId) =>
                    restoreContentDatabase.mutateAsync({ databaseId }),
                  ),
                ).catch((err) => {
                  toast.error("Failed to restore database", {
                    description:
                      err instanceof Error
                        ? err.message
                        : "Something went wrong",
                  });
                });
              },
            },
          });
        }
      },
    },
  );
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useActionMutation<
    { success: boolean; deleted: number; removed?: number },
    { id: string; databaseDocumentId?: string }
  >("delete-document", {
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["action", "list-documents"],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-document", { id: variables.id }],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database"],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "list-trashed-content-databases"],
      });
    },
  });
}

export function useMoveDocument() {
  const queryClient = useQueryClient();
  return useActionMutation<Document, DocumentMoveRequest & { id: string }>(
    "move-document",
    {
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
        queryClient.invalidateQueries({
          queryKey: ["action", "get-document", { id: variables.id }],
        });
      },
    },
  );
}

export function buildDocumentTree(
  documents: Document[] | undefined | null,
): DocumentTreeNode[] {
  if (!Array.isArray(documents)) return [];
  const map = new Map<string, DocumentTreeNode>();
  const orderedDocuments: Document[] = [];
  const roots: DocumentTreeNode[] = [];

  // Create nodes
  for (const doc of documents) {
    if (map.has(doc.id)) continue;
    map.set(doc.id, { ...doc, children: [] });
    orderedDocuments.push(doc);
  }

  const parentById = new Map(
    orderedDocuments.map((doc) => [doc.id, doc.parentId]),
  );

  function hasParentCycle(doc: Document) {
    const seen = new Set([doc.id]);
    let parentId = doc.parentId;
    while (parentId && map.has(parentId)) {
      if (seen.has(parentId)) return true;
      seen.add(parentId);
      parentId = parentById.get(parentId) ?? null;
    }
    return false;
  }

  // Build tree
  for (const doc of orderedDocuments) {
    const node = map.get(doc.id)!;
    if (
      doc.parentId &&
      map.has(doc.parentId) &&
      doc.parentId !== doc.id &&
      !hasParentCycle(doc)
    ) {
      map.get(doc.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children by position
  const sortChildren = (nodes: DocumentTreeNode[]) => {
    nodes.sort((a, b) => a.position - b.position);
    for (const node of nodes) sortChildren(node.children);
  };
  sortChildren(roots);

  return roots;
}

export function filterDocumentTreeDocuments(
  documents: Document[] | undefined | null,
): Document[] {
  if (!Array.isArray(documents)) return [];

  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const hiddenIds = new Set<string>();

  function isDatabaseContainedDocument(doc: Document) {
    if (doc.databaseMembership) {
      hiddenIds.add(doc.id);
      return true;
    }
    if (hiddenIds.has(doc.id)) return true;

    const seen = new Set([doc.id]);
    let parentId = doc.parentId;

    while (parentId && byId.has(parentId)) {
      if (seen.has(parentId)) return false;
      seen.add(parentId);

      const parent = byId.get(parentId)!;
      if (parent.databaseMembership || hiddenIds.has(parent.id)) {
        hiddenIds.add(doc.id);
        return true;
      }

      parentId = parent.parentId;
    }

    return false;
  }

  return documents.filter((doc) => !isDatabaseContainedDocument(doc));
}
