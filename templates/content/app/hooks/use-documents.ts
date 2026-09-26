import {
  callAction,
  useActionQuery,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type {
  ContentDatabaseItemsPageResponse,
  ContentDatabaseResponse,
  ContentDatabaseItem,
  Document,
  DocumentCreateRequest,
  DocumentCreateResult,
  DocumentListResponse,
  DocumentPropertiesResponse,
  DocumentUpdateRequest,
  DocumentUpdateResponse,
  DocumentMoveRequest,
  ListTrashedDocumentsResponse,
  DocumentTreeNode,
} from "@shared/api";
import type { ContentSidebarSections } from "@shared/content-personal-navigation";
import type { ContentRecentResult } from "@shared/content-personal-navigation";
import { applyContentPersonalNavigationPatch } from "@shared/content-personal-navigation-patch";
import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { DocumentUpdateConflictResponse } from "../../actions/update-document";
import type { ContentTrashPurgePlanResponse } from "../../shared/content-trash";
import {
  documentQueryFilter,
  type DocumentQueryContext,
} from "../lib/document-query";
import {
  documentScopedReadRetryOptions,
  isWithinCreateSettlingWindow,
} from "../lib/document-scoped-read-retry";
import {
  contentDatabaseConstrainedQueryFilter,
  contentDatabaseItemsContainingDocumentFilter,
  invalidateContentDatabaseNavigationQueries,
  removeOptimisticItemFromContentDatabase,
  useRestoreContentDatabase,
} from "./use-content-database";

export {
  documentQueryFilter,
  documentQueryKey,
  type DocumentQueryContext,
} from "../lib/document-query";

export type { DocumentUpdateConflictResponse };

export type PageOwnedDocumentCachePatch = Pick<
  Partial<Document>,
  | "id"
  | "parentId"
  | "title"
  | "content"
  | "description"
  | "icon"
  | "position"
  | "isFavorite"
  | "hideFromSearch"
  | "visibility"
  | "accessRole"
  | "canComment"
  | "canSuggest"
  | "canEdit"
  | "canManage"
  | "source"
  | "createdAt"
  | "updatedAt"
  | "revision"
  | "bodyRevision"
  | "contentHash"
>;

export const LIST_DOCUMENTS_QUERY_KEY = [
  "action",
  "list-documents",
  undefined,
] as const;

export function restoreListDocumentsSnapshot(
  queryClient: Pick<QueryClient, "removeQueries" | "setQueryData">,
  snapshot: unknown,
) {
  if (snapshot === undefined) {
    queryClient.removeQueries({ queryKey: LIST_DOCUMENTS_QUERY_KEY });
    return;
  }
  queryClient.setQueryData(LIST_DOCUMENTS_QUERY_KEY, snapshot);
}

export function rollbackOptimisticCreatedDocument(
  queryClient: Pick<
    QueryClient,
    "getQueryData" | "removeQueries" | "setQueryData"
  >,
  documentId: string,
  hadListSnapshot: boolean,
) {
  const current = queryClient.getQueryData(LIST_DOCUMENTS_QUERY_KEY);
  const documents: Document[] = Array.isArray(current)
    ? current
    : ((current as DocumentListResponse | undefined)?.documents ?? []);
  const remaining = documents.filter((document) => document.id !== documentId);

  if (!hadListSnapshot && remaining.length === 0) {
    queryClient.removeQueries({ queryKey: LIST_DOCUMENTS_QUERY_KEY });
    return;
  }

  if (Array.isArray(current)) {
    queryClient.setQueryData(LIST_DOCUMENTS_QUERY_KEY, remaining);
    return;
  }

  queryClient.setQueryData(LIST_DOCUMENTS_QUERY_KEY, {
    ...(current && typeof current === "object" ? current : {}),
    documents: remaining,
  });
}

export function restoreDeletedDocumentSnapshots(
  queryClient: Pick<QueryClient, "getQueryData" | "setQueryData">,
  listSnapshot: unknown,
  documentSnapshots: Array<[readonly unknown[], unknown]>,
  deletedDocumentIds: Iterable<string>,
) {
  const deletedIds = new Set(deletedDocumentIds);
  const snapshotDocuments: Document[] = Array.isArray(listSnapshot)
    ? listSnapshot
    : ((listSnapshot as DocumentListResponse | undefined)?.documents ?? []);
  const current = queryClient.getQueryData(LIST_DOCUMENTS_QUERY_KEY);
  const currentDocuments: Document[] = Array.isArray(current)
    ? current
    : ((current as DocumentListResponse | undefined)?.documents ?? []);
  const currentDocumentIds = new Set(
    currentDocuments.map((document) => document.id),
  );
  const restoredDocuments = snapshotDocuments.filter(
    (document) =>
      deletedIds.has(document.id) && !currentDocumentIds.has(document.id),
  );
  const documents = [...currentDocuments, ...restoredDocuments];

  if (Array.isArray(current)) {
    queryClient.setQueryData(LIST_DOCUMENTS_QUERY_KEY, documents);
  } else {
    queryClient.setQueryData(LIST_DOCUMENTS_QUERY_KEY, {
      ...(current && typeof current === "object"
        ? current
        : listSnapshot && typeof listSnapshot === "object"
          ? listSnapshot
          : {}),
      documents,
    });
  }
  for (const [queryKey, data] of documentSnapshots) {
    if (queryClient.getQueryData(queryKey) === undefined) {
      queryClient.setQueryData(queryKey, data);
    }
  }
}

const DOCUMENT_LIST_PAGE_SIZE = 200;

export async function fetchCompleteDocumentList(
  fetchPage: (offset: number, limit: number) => Promise<DocumentListResponse>,
) {
  const documents: Document[] = [];
  const documentIds = new Set<string>();
  let offset = 0;
  let expectedTotal: number | null = null;

  while (true) {
    const page = await fetchPage(offset, DOCUMENT_LIST_PAGE_SIZE);
    const { pagination } = page;
    if (!pagination) {
      throw new Error(
        "list-documents returned no pagination boundary; refusing to treat the result as complete.",
      );
    }
    if (
      pagination.offset !== offset ||
      pagination.limit !== DOCUMENT_LIST_PAGE_SIZE ||
      pagination.returnedItems !== page.documents.length
    ) {
      throw new Error(
        "list-documents returned inconsistent pagination metadata; retry the complete read.",
      );
    }
    if (expectedTotal === null) expectedTotal = pagination.totalItems;
    if (pagination.totalItems !== expectedTotal) {
      throw new Error(
        "Documents changed during paginated discovery; retry the complete read.",
      );
    }
    for (const document of page.documents) {
      if (documentIds.has(document.id)) {
        throw new Error(
          `list-documents repeated document "${document.id}" across pages; refusing an ambiguous result.`,
        );
      }
      documentIds.add(document.id);
      documents.push(document);
    }

    const expectedNextOffset = offset + page.documents.length;
    if (!pagination.hasMore) {
      if (
        pagination.nextOffset !== null ||
        expectedNextOffset !== expectedTotal ||
        documents.length !== expectedTotal
      ) {
        throw new Error(
          "list-documents claimed exhaustion before every declared document was returned.",
        );
      }
      return documents;
    }
    if (
      pagination.nextOffset !== expectedNextOffset ||
      pagination.nextOffset <= offset
    ) {
      throw new Error(
        "list-documents returned a non-advancing continuation; refusing a clipped result.",
      );
    }
    offset = pagination.nextOffset;
  }
}

export function documentPropertiesQueryKey(
  documentId: string,
  databaseId: string | null,
) {
  return [
    "action",
    "list-document-properties",
    { documentId, databaseId },
  ] as const;
}

export type DocumentUpdateRequestWithCas = DocumentUpdateRequest & {
  id: string;
  baseUpdatedAt?: string;
  baseRevision?: string;
  baseTitle?: string;
  editorSessionId?: string;
  editorEditGeneration?: number;
  editorSnapshotTitle?: string;
  editorSnapshotContent?: string;
};

export type DocumentUpdateResult =
  | DocumentUpdateResponse
  | DocumentUpdateConflictResponse;

export function isDocumentUpdateConflict(
  result: Document | DocumentUpdateResult,
): result is DocumentUpdateConflictResponse {
  return (result as DocumentUpdateConflictResponse)?.conflict === true;
}

export function mergeDocumentIntoDocumentCache(
  old: unknown,
  document: Document,
) {
  const pageOwnedPatch: PageOwnedDocumentCachePatch = {
    id: document.id,
    parentId: document.parentId,
    title: document.title,
    content: document.content,
    description: document.description,
    icon: document.icon,
    position: document.position,
    isFavorite: document.isFavorite,
    hideFromSearch: document.hideFromSearch,
    visibility: document.visibility,
    accessRole: document.accessRole,
    canComment: document.canComment,
    ...(document.canSuggest !== undefined
      ? { canSuggest: document.canSuggest }
      : {}),
    canEdit: document.canEdit,
    canManage: document.canManage,
    source: document.source,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    revision: document.revision,
    bodyRevision: document.bodyRevision,
    contentHash: document.contentHash,
  };
  return old && typeof old === "object"
    ? { ...old, ...pageOwnedPatch }
    : pageOwnedPatch;
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

export function patchDocumentInDatabaseCache<
  T extends
    | ContentDatabaseResponse
    | ContentDatabaseItemsPageResponse
    | import("@shared/api").ContentDatabaseNavigationPageResponse,
>(
  current: T | undefined,
  documentId: string,
  patch: Partial<Document>,
): T | undefined {
  if (!current) return current;
  let changed = false;
  const items = current.items.map((item) => {
    if (!("document" in item)) {
      if (item.documentId !== documentId) return item;
      changed = true;
      return {
        ...item,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
        ...(patch.isFavorite !== undefined
          ? { isFavorite: patch.isFavorite }
          : {}),
        ...(patch.updatedAt !== undefined
          ? { updatedAt: patch.updatedAt }
          : {}),
      };
    }
    if (item.document.id !== documentId) return item;
    changed = true;
    return {
      ...item,
      document: { ...item.document, ...patch },
    };
  });
  return changed ? ({ ...current, items } as T) : current;
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

export function isFavoritesDatabaseCache(
  current: unknown,
): current is ContentDatabaseResponse {
  if (!current || typeof current !== "object") return false;
  return (
    (current as Partial<ContentDatabaseResponse>).database?.systemRole ===
    "favorites"
  );
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
  patch: PageOwnedDocumentCachePatch,
) {
  queryClient.setQueriesData(documentQueryFilter(documentId), (old: unknown) =>
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
  queryClient.setQueriesData<ContentDatabaseItemsPageResponse>(
    contentDatabaseItemsContainingDocumentFilter(documentId),
    (current) => patchDocumentInDatabaseCache(current, documentId, patch),
  );
  queryClient.setQueriesData<{ entries: ContentRecentResult[] }>(
    { queryKey: ["action", "get-content-recent"] },
    (current) => {
      if (!current || patch.title === undefined) return current;
      let changed = false;
      const entries = current.entries.map((entry) => {
        if (entry.target.documentId !== documentId) return entry;
        changed = true;
        return { ...entry, title: patch.title! };
      });
      return changed ? { ...current, entries } : current;
    },
  );
  queryClient.setQueriesData<{
    document?: Document;
    path?: Array<Partial<Document> & { id: string }>;
  }>({ queryKey: ["action", "get-content-navigation-context"] }, (current) => {
    if (!current) return current;
    const document =
      current.document?.id === documentId
        ? { ...current.document, ...patch }
        : current.document;
    let pathChanged = false;
    const path = current.path?.map((entry) => {
      if (entry.id !== documentId) return entry;
      pathChanged = true;
      return { ...entry, ...patch };
    });
    return document !== current.document || pathChanged
      ? { ...current, document, path }
      : current;
  });
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
): PageOwnedDocumentCachePatch {
  return {
    updatedAt: data.updatedAt,
    revision: data.revision,
    bodyRevision: data.bodyRevision,
    contentHash: data.contentHash,
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
  if (
    queryClient.getQueryData(
      documentPropertiesQueryKey(item.document.id, item.databaseId),
    ) === undefined
  ) {
    queryClient.setQueryData<DocumentPropertiesResponse>(
      documentPropertiesQueryKey(item.document.id, item.databaseId),
      {
        documentId: item.document.id,
        databaseId: item.databaseId,
        canEditValues: false,
        canManageSchema: false,
        properties: item.properties,
      },
      { updatedAt: 0 },
    );
  }
}

export function useDocuments(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: LIST_DOCUMENTS_QUERY_KEY,
    queryFn: async ({ signal }) => ({
      documents: await fetchCompleteDocumentList((offset, limit) =>
        callAction<DocumentListResponse>(
          "list-documents",
          { offset, limit },
          { method: "GET", signal },
        ),
      ),
    }),
    select: (data) => data.documents,
    retry: false,
    enabled: options?.enabled !== false,
  });
}

export const DOCUMENT_QUERY_FRESHNESS_OPTIONS = {
  staleTime: 0,
  refetchOnMount: "always" as const,
  retry: false,
};

export function useDocument(
  id: string | null,
  context: DocumentQueryContext = {},
) {
  return useActionQuery<Document>(
    "get-document",
    id
      ? {
          id,
          ...(context.databaseId ? { databaseId: context.databaseId } : {}),
          ...(context.databaseDocumentId
            ? { databaseDocumentId: context.databaseDocumentId }
            : {}),
        }
      : undefined,
    {
      enabled: !!id,
      ...DOCUMENT_QUERY_FRESHNESS_OPTIONS,
    },
  );
}

export interface PreviewDocumentDraftRecord {
  documentId: string;
  title: string;
  content: string;
  baseDocumentUpdatedAt: string | null;
  loadedContentWasEmpty: number;
  deferredReason: string | null;
  editorSessionId: string | null;
  editGeneration: number | null;
  version: number;
  updatedAt: string;
}

export function usePreviewDocumentDraft(
  documentId: string | null,
  options: { enabled?: boolean; createdAt?: string | null } = {},
) {
  return useActionQuery<{ draft: PreviewDocumentDraftRecord | null }>(
    "get-preview-document-draft",
    documentId ? { documentId } : undefined,
    {
      enabled: !!documentId && options.enabled !== false,
      // The caller gates this off while it knows creation is pending. A 403/404
      // that still arrives for a row that young is one this connection cannot
      // see yet rather than a refusal, so ride it out. Once the row is past its
      // settling window a 403 is a real authorization answer and stays terminal.
      ...documentScopedReadRetryOptions(
        isWithinCreateSettlingWindow(options.createdAt),
      ),
    },
  );
}

export function useUpdatePreviewDocumentDraft() {
  return useActionMutation<
    {
      status: "saved" | "deleted" | "conflict" | "superseded";
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
          editorSessionId?: string;
          editGeneration?: number;
        };
      }
    | {
        operation: "delete";
        documentId: string;
        expectedVersion: number;
        expectedTitle: string;
        expectedContent: string;
        expectedEditorSessionId?: string;
        expectedEditGeneration?: number;
      }
  >("update-preview-document-draft", {
    skipActionQueryInvalidation: true,
  });
}

export function useResolvePreviewDocumentDraft() {
  return useActionMutation<
    {
      status: "resolved" | "document_conflict";
      choice?: "keep_mine" | "use_saved" | "save_separately";
      document?: Document;
      createdDocumentId?: string;
      urlPath?: string;
    },
    {
      choice: "keep_mine" | "use_saved" | "save_separately";
      documentId: string;
      expectedDraftVersion: number;
      expectedDraftTitle: string;
      expectedDraftContent: string;
      expectedDocumentUpdatedAt?: string;
    }
  >("resolve-preview-document-draft");
}

export function useCreateDocument() {
  const queryClient = useQueryClient();
  return useActionMutation<DocumentCreateResult, DocumentCreateRequest>(
    "create-document",
    {
      skipActionQueryInvalidation: true,
      onSuccess: () => invalidateContentDatabaseNavigationQueries(queryClient),
    },
  );
}

export function useUpdateDocument() {
  const queryClient = useQueryClient();
  const t = useT();
  const restoreContentDatabase = useRestoreContentDatabase();
  const updateSidebarState = useActionMutation("update-content-sidebar-state", {
    skipActionQueryInvalidation: true,
  });
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

        const documentFilter = documentQueryFilter(variables.id);
        const databaseFilter = {
          queryKey: ["action", "get-content-database"],
        } as const;
        const databasePageFilter = contentDatabaseItemsContainingDocumentFilter(
          variables.id,
        );
        const contentSpacesFilter = {
          queryKey: ["action", "list-content-spaces"],
        } as const;
        const personalViewFilter = {
          queryKey: ["action", "get-content-database-personal-view"],
        } as const;
        const sidebarStateEntry = currentContentSidebarState(
          queryClient,
          currentDocumentSpaceId(queryClient, variables.id),
        );
        const sidebarStateKey = sidebarStateEntry?.[0];
        const documentSpaceId = sidebarStateKey?.[2].spaceId;
        await Promise.all([
          queryClient.cancelQueries(documentFilter),
          queryClient.cancelQueries({ queryKey: LIST_DOCUMENTS_QUERY_KEY }),
          queryClient.cancelQueries(databaseFilter),
          queryClient.cancelQueries(databasePageFilter),
          queryClient.cancelQueries(contentSpacesFilter),
          queryClient.cancelQueries(personalViewFilter),
        ]);

        const previous: Array<[readonly unknown[], unknown]> = [
          ...queryClient.getQueriesData(documentFilter),
          [
            LIST_DOCUMENTS_QUERY_KEY,
            queryClient.getQueryData(LIST_DOCUMENTS_QUERY_KEY),
          ],
          ...queryClient.getQueriesData<ContentDatabaseResponse>(
            databaseFilter,
          ),
          ...queryClient.getQueriesData<ContentDatabaseItemsPageResponse>(
            databasePageFilter,
          ),
          ...queryClient.getQueriesData(contentSpacesFilter),
          ...queryClient.getQueriesData(personalViewFilter),
          ...(sidebarStateKey
            ? [
                [
                  sidebarStateKey,
                  queryClient.getQueryData(sidebarStateKey),
                ] as [readonly unknown[], unknown],
              ]
            : []),
        ];

        const sidebarState = sidebarStateEntry?.[1];
        const sidebarSpaceId = sidebarStateKey?.[2].spaceId;
        const nextSidebarState =
          variables.isFavorite === true &&
          sidebarState?.state?.sections.pinned.visible &&
          !sidebarState.state.sections.pinned.expanded
            ? {
                version: 2 as const,
                ...(typeof sidebarSpaceId === "string"
                  ? { spaceId: sidebarSpaceId }
                  : {}),
                sections: {
                  ...sidebarState.state.sections,
                  pinned: {
                    ...sidebarState.state.sections.pinned,
                    expanded: true,
                  },
                },
              }
            : undefined;
        if (nextSidebarState && sidebarStateKey)
          queryClient.setQueryData(sidebarStateKey, {
            state: nextSidebarState,
          });

        if (variables.isFavorite === true) {
          const listSnapshot = queryClient.getQueryData(
            LIST_DOCUMENTS_QUERY_KEY,
          );
          const documents: Document[] = Array.isArray(listSnapshot)
            ? listSnapshot
            : ((listSnapshot as DocumentListResponse | undefined)?.documents ??
              []);
          const document = documents.find(
            (candidate) => candidate.id === variables.id,
          );
          if (document) {
            for (const [
              databaseKey,
              database,
            ] of queryClient.getQueriesData<ContentDatabaseResponse>({
              queryKey: ["action", "get-content-database"],
            })) {
              if (!isFavoritesDatabaseCache(database)) continue;
              if (
                (databaseKey[2] as { contentSpaceId?: unknown } | undefined)
                  ?.contentSpaceId !== documentSpaceId
              )
                continue;
              if (
                database.items.some((item) => item.document.id === variables.id)
              )
                continue;
              const optimisticItemId = `optimistic-favorite:${variables.id}`;
              queryClient.setQueryData(databaseKey, {
                ...database,
                items: [
                  {
                    id: optimisticItemId,
                    databaseId: database.database.id,
                    position: -1,
                    properties: [],
                    document: { ...document, isFavorite: true },
                  },
                  ...database.items,
                ],
              });
              const personalKey = [
                "action",
                "get-content-database-personal-view",
                { databaseId: database.database.id },
              ] as const;
              queryClient.setQueryData<{
                databaseId: string;
                overrides:
                  | import("@shared/api").ContentDatabasePersonalViewOverrides
                  | null;
              }>(personalKey, (current) => {
                if (!current?.overrides) return current;
                const activeViewId =
                  current.overrides.activeViewId ??
                  database.database.viewConfig.activeViewId;
                return {
                  ...current,
                  overrides: applyContentPersonalNavigationPatch(
                    current.overrides,
                    {
                      sidebarOrder: {
                        operation: "prepend",
                        viewId: activeViewId,
                        itemId: optimisticItemId,
                      },
                    },
                  ),
                };
              });
            }
          }
        }

        patchDocumentCaches(queryClient, variables.id, optimisticPatch);
        const renamedContentSpace =
          variables.title !== undefined
            ? patchContentSpaceNameCaches(
                queryClient,
                variables.id,
                variables.title,
              )
            : false;

        return {
          previous,
          renamedContentSpace,
          nextSidebarState,
          sidebarStateKey,
        };
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
        const nextSidebarState = (
          context as
            | {
                nextSidebarState?: {
                  version: 2;
                  sections: ContentSidebarSections;
                };
              }
            | undefined
        )?.nextSidebarState;
        const sidebarStateKey = (
          context as
            | {
                sidebarStateKey?: readonly [
                  "action",
                  "get-content-sidebar-state",
                  { spaceId: string },
                ];
              }
            | undefined
        )?.sidebarStateKey;
        const previousSidebarState = (
          context as
            | { previous?: Array<[readonly unknown[], unknown]> }
            | undefined
        )?.previous?.find(
          ([key]) => key[1] === "get-content-sidebar-state",
        )?.[1] as
          | { state?: { version: 2; sections: ContentSidebarSections } }
          | undefined;
        if (isDocumentUpdateConflict(data)) {
          const serverDocument = data.document;
          queryClient.setQueriesData(
            documentQueryFilter(variables.id),
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
          queryClient.setQueriesData<ContentDatabaseItemsPageResponse>(
            contentDatabaseItemsContainingDocumentFilter(variables.id),
            (current) =>
              patchDocumentInDatabaseCache(
                current,
                variables.id,
                serverDocument,
              ),
          );
          patchDocumentCaches(queryClient, variables.id, serverDocument);
          if (renamedContentSpace) {
            patchContentSpaceNameCaches(
              queryClient,
              variables.id,
              serverDocument.title,
            );
            void queryClient.invalidateQueries({
              queryKey: ["action", "list-content-spaces"],
            });
            void queryClient.invalidateQueries({
              queryKey: ["action", "get-content-database"],
            });
          }
          void queryClient.invalidateQueries(documentQueryFilter(variables.id));
          void queryClient.invalidateQueries({
            queryKey: ["action", "list-documents"],
          });
          void queryClient.invalidateQueries(
            contentDatabaseConstrainedQueryFilter(),
          );
          if (variables.title !== undefined) {
            invalidateContentDatabaseNavigationQueries(queryClient);
            void queryClient.invalidateQueries({
              queryKey: ["action", "get-content-recent"],
            });
            void queryClient.invalidateQueries({
              queryKey: ["action", "get-content-navigation-context"],
            });
          }
          return;
        }

        patchDocumentCaches(
          queryClient,
          variables.id,
          documentUpdateSuccessPatch(data, variables),
        );
        if (variables.title !== undefined) {
          void queryClient.invalidateQueries(
            contentDatabaseConstrainedQueryFilter(),
          );
          invalidateContentDatabaseNavigationQueries(queryClient);
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-content-recent"],
          });
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-content-navigation-context"],
          });
        }
        if (renamedContentSpace) {
          patchContentSpaceNameCaches(queryClient, variables.id, data.title);
          void queryClient.invalidateQueries({
            queryKey: ["action", "list-content-spaces"],
          });
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-content-database"],
          });
        }
        if (variables.isFavorite !== undefined) {
          invalidateContentDatabaseNavigationQueries(queryClient);
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-content-database"],
          });
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-content-database-personal-view"],
          });
          if (nextSidebarState && sidebarStateKey)
            void updateSidebarState
              .mutateAsync({
                version: 2,
                spaceId: sidebarStateKey[2].spaceId,
                sectionsPatch: { pinned: { expanded: true } },
              })
              .then(
                (saved) => queryClient.setQueryData(sidebarStateKey, saved),
                () =>
                  queryClient.invalidateQueries({
                    queryKey: ["action", "get-content-sidebar-state"],
                  }),
              );
          if (
            variables.isFavorite === true &&
            previousSidebarState?.state?.sections.pinned.visible === false
          ) {
            toast(t("sidebar.pinned"), {
              action: {
                label: t("editor.properties.show"),
                onClick: () => {
                  if (!sidebarStateKey) {
                    toast.error(t("sidebar.failedSaveSidebarState"));
                    return;
                  }
                  const current = queryClient.getQueryData<{
                    state?: {
                      version: 2;
                      sections: ContentSidebarSections;
                    };
                  }>(sidebarStateKey);
                  if (!current?.state) {
                    toast.error(t("sidebar.failedSaveSidebarState"));
                    void queryClient.invalidateQueries({
                      queryKey: ["action", "get-content-sidebar-state"],
                    });
                    return;
                  }
                  const next = {
                    version: 2 as const,
                    spaceId: sidebarStateKey[2].spaceId,
                    sections: {
                      ...current.state.sections,
                      pinned: {
                        ...current.state.sections.pinned,
                        visible: true,
                        expanded: true,
                      },
                    },
                  };
                  queryClient.setQueryData(sidebarStateKey, { state: next });
                  void updateSidebarState
                    .mutateAsync({
                      version: 2,
                      spaceId: sidebarStateKey[2].spaceId,
                      sectionsPatch: {
                        pinned: { visible: true, expanded: true },
                      },
                    })
                    .then(
                      (saved) =>
                        queryClient.setQueryData(sidebarStateKey, saved),
                      () => {
                        queryClient.setQueryData(sidebarStateKey, current);
                        toast.error(t("sidebar.failedSaveSidebarState"));
                      },
                    );
                },
              },
            });
          }
        }

        if (data.softDeletedDatabaseIds.length > 0) {
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-content-database"],
          });
          void queryClient.invalidateQueries({
            queryKey: ["action", "list-trashed-content-databases"],
          });
          const databaseIds = data.softDeletedDatabaseIds;
          toast("Collection deleted", {
            action: {
              label: "Undo",
              onClick: () => {
                void Promise.all(
                  databaseIds.map((databaseId) =>
                    restoreContentDatabase.mutateAsync({ databaseId }),
                  ),
                ).catch((err) => {
                  toast.error("Failed to restore collection", {
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
    {
      success: boolean;
      deleted: number;
      removed?: number;
      activeTargetDeleted?: boolean;
      navigationPath?: string | null;
    },
    { id: string; databaseDocumentId?: string; activeDocumentId?: string }
  >("delete-document", {
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-documents"],
      });
      void queryClient.invalidateQueries(documentQueryFilter(variables.id));
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-content-spaces"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-trashed-content-databases"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-trashed-documents"],
      });
      invalidateContentDatabaseNavigationQueries(queryClient);
    },
  });
}

export function useRollbackCreatedSlashDocument() {
  const queryClient = useQueryClient();
  return useActionMutation<
    {
      success: boolean;
      id: string;
      disposition: "trashed" | "absent";
      deletedIds: string[];
    },
    { id: string; parentId: string }
  >("rollback-created-slash-document", {
    onSuccess: (_result, { id }) => {
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-documents"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-trashed-documents"],
      });
      void queryClient.invalidateQueries(documentQueryFilter(id));
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-trashed-content-databases"],
      });
      invalidateContentDatabaseNavigationQueries(queryClient);
    },
  });
}

export function useTrashedDocuments() {
  return useActionQuery<ListTrashedDocumentsResponse>(
    "list-trashed-documents",
    {},
  );
}

export function useRestoreDocument() {
  const queryClient = useQueryClient();
  return useActionMutation<
    { success: boolean; restored: number; documentId: string },
    { id: string }
  >("restore-document", {
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-documents"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-content-database"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-trashed-documents"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-trashed-content-databases"],
      });
      invalidateContentDatabaseNavigationQueries(queryClient);
    },
  });
}

export function usePermanentlyDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation<
    { success: boolean; deleted: number },
    Error,
    { id: string }
  >({
    mutationFn: async ({ id }) => {
      const plan = await callAction<ContentTrashPurgePlanResponse>(
        "plan-content-trash-purge",
        { mode: "selection", documentIds: [id] },
      );
      return callAction<{ success: boolean; deleted: number }>(
        "permanently-delete-document",
        { id, planId: plan.planId, scopeToken: plan.scopeToken },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["action"] });
    },
  });
}

export function useMoveDocument() {
  const queryClient = useQueryClient();
  return useActionMutation<Document, DocumentMoveRequest & { id: string }>(
    "move-document",
    {
      onSuccess: (_data, variables) => {
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-documents"],
        });
        void queryClient.invalidateQueries(documentQueryFilter(variables.id));
        invalidateContentDatabaseNavigationQueries(queryClient);
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
function currentDocumentSpaceId(queryClient: QueryClient, documentId: string) {
  const document = queryClient
    .getQueriesData<Document>(documentQueryFilter(documentId))
    .find(([, data]) => data?.id === documentId)?.[1];
  if (document?.spaceId) return document.spaceId;
  const list = queryClient.getQueryData<Document[] | DocumentListResponse>(
    LIST_DOCUMENTS_QUERY_KEY,
  );
  const documents = Array.isArray(list) ? list : list?.documents;
  return documents?.find((candidate) => candidate.id === documentId)?.spaceId;
}

function currentContentSidebarState(
  queryClient: QueryClient,
  spaceId: string | null | undefined,
) {
  if (!spaceId) return undefined;
  const key = ["action", "get-content-sidebar-state", { spaceId }] as const;
  const data = queryClient.getQueryData<{
    state?: { version: 2; sections: ContentSidebarSections };
  }>(key);
  return data?.state?.sections ? ([key, data] as const) : undefined;
}
