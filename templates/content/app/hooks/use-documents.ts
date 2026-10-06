import {
  callAction,
  useActionQuery,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { serializeIconValue } from "@agent-native/core/icons";
import type {
  ContentDatabaseItemsPageResponse,
  ContentDatabaseNavigationPageResponse,
  ContentDatabaseResponse,
  ContentDatabaseItem,
  ContentLinkTarget,
  ContentNavigationContext,
  ContentNavigationPathEntry,
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
import {
  hashKey,
  isCancelledError,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import type {
  DocumentUpdateConflictResponse,
  DocumentUpdateSupersededResponse,
} from "../../actions/update-document";
import type { ContentTrashPurgePlanResponse } from "../../shared/content-trash";
import {
  documentQueryFilter,
  documentQueryKey,
  type DocumentQueryContext,
} from "../lib/document-query";
import {
  documentScopedReadRetryOptions,
  isWithinCreateSettlingWindow,
} from "../lib/document-scoped-read-retry";
import { isDocumentCreationPending } from "../lib/optimistic-document";
import {
  adoptPageOpenRead,
  claimPageOpenRead,
  releasePageOpenRead,
  spoilPageOpenReads,
  startPageOpenRead,
  type PageOpenRead,
  type PageOpenReadAdoption,
} from "../lib/page-open-reads";
import {
  contentFilesCollectionFilter,
  contentNavigationBranchFilter,
  contentNavigationContextFilter,
  contentPlacementTargets,
  contentRowTargets,
  contentSpaceFilesDatabaseId,
  documentScopedQueryFilter,
  invalidateContentQueries,
  useContentActionMutation,
  type ContentQueryTarget,
} from "./use-content-action-mutation";
import {
  contentDatabaseConstrainedQueryFilter,
  contentDatabaseItemsContainingDocumentFilter,
  contentDatabaseNavigationQueryFilter,
  invalidateContentDatabaseNavigationQueries,
  removeOptimisticItemFromContentDatabase,
  useRestoreContentDatabase,
} from "./use-content-database";
import { CONTENT_LINK_TARGETS_QUERY_KEY } from "./use-content-links";

export {
  documentQueryFilter,
  documentQueryKey,
  type DocumentQueryContext,
} from "../lib/document-query";

export type {
  DocumentUpdateConflictResponse,
  DocumentUpdateSupersededResponse,
};

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
  browserSaveAttemptId?: string;
  authoredBaseRevision?: string;
  authoredBaseContent?: string;
  authoredCandidateContent?: string;
  editorSnapshotTitle?: string;
  editorSnapshotContent?: string;
};

export type DocumentUpdateResult =
  | DocumentUpdateResponse
  | DocumentUpdateConflictResponse
  | DocumentUpdateSupersededResponse
  | DocumentUpdatePreservationResponse;

export type DocumentUpdatePreservationResponse = {
  preservationRequired: true;
  id: string;
  document: DocumentUpdateResponse;
  reason: "structure" | "provenance";
  checkpointId: string;
};

export function isDocumentUpdatePreservationRequired(
  result: Document | DocumentUpdateResult,
): result is DocumentUpdatePreservationResponse {
  return (
    (result as DocumentUpdatePreservationResponse)?.preservationRequired ===
    true
  );
}

export function isDocumentUpdateConflict(
  result: Document | DocumentUpdateResult,
): result is DocumentUpdateConflictResponse {
  return (result as DocumentUpdateConflictResponse)?.conflict === true;
}

export function isDocumentUpdateSuperseded(
  result: Document | DocumentUpdateResult,
): result is DocumentUpdateSupersededResponse {
  return (result as DocumentUpdateSupersededResponse)?.superseded === true;
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
  if (patch.title !== undefined) {
    queryClient.setQueriesData<ContentLinkTarget | null>(
      { queryKey: CONTENT_LINK_TARGETS_QUERY_KEY },
      (current) =>
        current && "documentId" in current && current.documentId === documentId
          ? { ...current, title: patch.title! }
          : current,
    );
  }
  queryClient.setQueriesData<{ entries: ContentRecentResult[] }>(
    { queryKey: ["action", "get-content-recent"] },
    (current) => {
      if (!current || (patch.title === undefined && patch.icon === undefined))
        return current;
      let changed = false;
      const entries = current.entries.map((entry) => {
        if (entry.target.documentId !== documentId) return entry;
        changed = true;
        return {
          ...entry,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.icon !== undefined
            ? {
                icon:
                  typeof patch.icon === "string"
                    ? patch.icon
                    : serializeIconValue(patch.icon),
              }
            : {}),
        };
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

const NAVIGATION_CONTEXT_QUERY_KEY = [
  "action",
  "get-content-navigation-context",
] as const;

/**
 * An optimistic page opens before the server has it, so its path read fails
 * and the sidebar would stop revealing the page's ancestors. Seed the path from
 * the parent's cached one and show the parent as expandable; the create's
 * refresh replaces both, and `removeCreatedDocumentNavigation` undoes them.
 * The sidebar reveals a path only through its space's Files membership, so
 * the new entry claims that membership too.
 */
export function seedCreatedDocumentNavigation(
  queryClient: Pick<
    QueryClient,
    "getQueriesData" | "setQueriesData" | "setQueryData"
  >,
  document: Document,
  workspaceFilesDatabaseId: string | null,
) {
  const parentId = document.parentId ?? null;
  let parentPath: ContentNavigationPathEntry[] = [];
  if (parentId) {
    for (const [
      ,
      context,
    ] of queryClient.getQueriesData<ContentNavigationContext>({
      queryKey: NAVIGATION_CONTEXT_QUERY_KEY,
    })) {
      const index =
        context?.path?.findIndex((entry) => entry.id === parentId) ?? -1;
      if (index >= 0) {
        parentPath = context!.path.slice(0, index + 1);
        workspaceFilesDatabaseId ??= context!.workspaceFilesDatabaseId;
        break;
      }
    }
    queryClient.setQueriesData<ContentDatabaseNavigationPageResponse>(
      contentNavigationBranchFilter({ documentIds: [parentId] }),
      (current) =>
        current && {
          ...current,
          items: current.items.map((item) =>
            item.documentId === parentId
              ? { ...item, hasChildren: true }
              : item,
          ),
        },
    );
  }
  queryClient.setQueryData<ContentNavigationContext>(
    [...NAVIGATION_CONTEXT_QUERY_KEY, { id: document.id }],
    {
      mode: "database",
      document,
      path: [
        ...parentPath,
        {
          id: document.id,
          parentId,
          title: document.title,
          icon: null,
          databaseId: workspaceFilesDatabaseId,
          databaseDocumentId:
            parentPath[parentPath.length - 1]?.databaseDocumentId ?? null,
          isFavorite: false,
          canEdit: true,
          canManage: true,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
        },
      ],
      workspaceFilesDatabaseId,
    },
  );
}

export function removeCreatedDocumentNavigation(
  queryClient: Pick<QueryClient, "invalidateQueries" | "removeQueries">,
  document: Pick<Document, "id" | "parentId">,
) {
  queryClient.removeQueries({
    queryKey: [...NAVIGATION_CONTEXT_QUERY_KEY, { id: document.id }],
    exact: true,
  });
  if (document.parentId) {
    invalidateContentQueries(queryClient, [
      contentNavigationBranchFilter({ documentIds: [document.parentId] }),
    ]);
  }
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

// The sidebar and the editor breadcrumbs read the same entry.
export function useContentNavigationContext(documentId: string | null) {
  return useActionQuery<ContentNavigationContext>(
    "get-content-navigation-context",
    documentId ? { id: documentId } : undefined,
    { enabled: Boolean(documentId) },
  );
}

export const DOCUMENT_QUERY_FRESHNESS_OPTIONS = {
  staleTime: 0,
  refetchOnMount: "always" as const,
  retry: false,
};

function documentReadParams(id: string, context: DocumentQueryContext) {
  return documentQueryKey(id, context)[2];
}

export function useDocument(
  id: string | null,
  context: DocumentQueryContext = {},
  options: { refetchOnMount?: false } = {},
) {
  return useActionQuery<Document>(
    "get-document",
    id ? documentReadParams(id, context) : undefined,
    {
      enabled: !!id,
      ...DOCUMENT_QUERY_FRESHNESS_OPTIONS,
      ...options,
    },
  );
}

// The page editor's read of its document. When a read started for this page
// open has already landed, it counts as fetched for this mount instead of
// being discarded and read again. Only the first mount can adopt; a later
// document switch reads fresh.
export function usePageOpenDocument(
  documentId: string,
  context: DocumentQueryContext,
) {
  const queryClient = useQueryClient();
  const queryKey = documentQueryKey(documentId, context);
  const queryHash = hashKey(queryKey);
  const claimRef = useRef<{
    queryHash: string;
    queryKey: typeof queryKey;
    adoption: PageOpenReadAdoption;
    read: PageOpenRead | null;
  } | null>(null);
  if (claimRef.current?.queryHash !== queryHash) {
    claimRef.current =
      claimRef.current === null
        ? { queryHash, queryKey, ...claimPageOpenRead(queryClient, queryKey) }
        : { queryHash, queryKey, adoption: "none", read: null };
  }
  const claim = claimRef.current;
  const { adoption } = claim;
  const query = useDocument(
    documentId,
    context,
    adoption === "fresh" ? { refetchOnMount: false } : {},
  );
  // Runs after the query's own subscription, so from here on sync reaches
  // this read as a mounted query.
  useEffect(() => {
    if (claim.read) {
      releasePageOpenRead(queryClient, claim.queryKey, claim.read);
    }
  }, [claim, queryClient]);
  return {
    query,
    fetchedForThisOpen: query.isFetchedAfterMount || adoption === "fresh",
    // The open's own reads, draft included, already started elsewhere.
    readsStartedEarly: adoption !== "none",
  };
}

export function startPageOpenDocumentReads(
  queryClient: QueryClient,
  documentId: string,
  context: DocumentQueryContext = {},
) {
  const queryKey = documentQueryKey(documentId, context);
  const cached = queryClient.getQueryData<Document>(queryKey);
  if (cached && isDocumentCreationPending(cached)) return;
  startPageOpenRead(queryClient, documentId, {
    queryKey,
    queryFn: ({ signal }) =>
      callAction<Document>(
        "get-document",
        documentReadParams(documentId, context),
        { method: "GET", signal },
      ),
    retry: false,
  });
  startPreviewDocumentDraftRead(queryClient, documentId, cached);
  if (cached?.source?.mode !== "local-files") {
    startPageOpenReviewReads(queryClient, documentId);
  }
}

// Open comments and suggestions hold the review margin open beside the page,
// so their reads start with the page read rather than after it lands. A page
// known to come from a local file has neither, so its open skips them.
export function startPageOpenReviewReads(
  queryClient: QueryClient,
  documentId: string,
) {
  const reads = [
    ["list-comments", { documentId }],
    [
      "list-resource-suggestions",
      { resourceType: "document", resourceId: documentId },
    ],
  ] as const;
  for (const [actionName, params] of reads) {
    void queryClient.prefetchQuery({
      queryKey: ["action", actionName, params],
      queryFn: ({ signal }) =>
        callAction(actionName, params, { method: "GET", signal }),
      retry: false,
    });
  }
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

// `editable: false` means the reader cannot edit the page, so it has no
// private draft to recover; it is not the same answer as `draft: null`.
export interface PreviewDocumentDraftResponse {
  draft: PreviewDocumentDraftRecord | null;
  editable: boolean;
}

function previewDocumentDraftReadOptions(
  documentId: string,
  createdAt?: string | null,
) {
  return {
    queryKey: ["action", "get-preview-document-draft", { documentId }] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      callAction<PreviewDocumentDraftResponse>(
        "get-preview-document-draft",
        { documentId },
        { method: "GET", signal },
      ),
    // A 403/404 for a row this young is one this connection cannot see yet
    // rather than a refusal, so ride it out. Once the row is past its settling
    // window a 403 is a real authorization answer and stays terminal.
    ...documentScopedReadRetryOptions(isWithinCreateSettlingWindow(createdAt)),
  };
}

export function usePreviewDocumentDraft(
  documentId: string,
  options: { enabled?: boolean; createdAt?: string | null } = {},
) {
  return useQuery({
    ...previewDocumentDraftReadOptions(documentId, options.createdAt),
    // The caller gates this off while it knows creation is pending.
    enabled: options.enabled !== false,
  });
}

// Starts the draft read that page recovery verifies, alongside the document
// read instead of after it. A page that is known not to need recovery skips
// it.
export function startPreviewDocumentDraftRead(
  queryClient: QueryClient,
  documentId: string,
  known?: Document,
) {
  if (
    known &&
    (isDocumentCreationPending(known) ||
      known.canEdit === false ||
      known.source?.mode === "local-files")
  ) {
    return;
  }
  startPageOpenRead(
    queryClient,
    documentId,
    previewDocumentDraftReadOptions(documentId, known?.createdAt),
  );
}

// Resolves once the current user's draft has been read for this page open:
// the open's own read when it is still usable, otherwise one fresh read.
// Rejects when that read fails or says the page is no longer editable.
export async function ensurePreviewDocumentDraftRead(
  queryClient: QueryClient,
  documentId: string,
  createdAt?: string | null,
) {
  const options = previewDocumentDraftReadOptions(documentId, createdAt);
  const result =
    adoptPageOpenRead(queryClient, options.queryKey) === "fresh"
      ? queryClient.getQueryData<PreviewDocumentDraftResponse>(options.queryKey)
      : await queryClient.fetchQuery({ ...options, staleTime: 0 });
  if (result?.editable === false) {
    throw new Error("The page is no longer editable by this user.");
  }
}

export function useUpdatePreviewDocumentDraft() {
  const queryClient = useQueryClient();
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
    // This tab's own draft writes never come back through sync.
    onMutate: (variables) => {
      spoilPageOpenReads(queryClient, variables.documentId);
    },
    onSettled: (_data, _error, variables) => {
      spoilPageOpenReads(queryClient, variables.documentId);
    },
  });
}

export function useResolvePreviewDocumentDraft() {
  return useContentActionMutation<
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
  >("resolve-preview-document-draft", {
    invalidates: (result, { documentId }) => [
      documentScopedQueryFilter(documentId),
      ...(result.choice === "keep_mine"
        ? [
            contentNavigationBranchFilter({ documentIds: [documentId] }),
            contentNavigationContextFilter([documentId]),
            ["action", "get-content-recent"],
            ["action", "list-documents"],
          ]
        : []),
      ...(result.createdDocumentId
        ? [
            contentNavigationBranchFilter({ parentIds: [null] }),
            ["action", "list-documents"],
          ]
        : []),
    ],
  });
}

export function useCreateDocument() {
  const queryClient = useQueryClient();
  return useActionMutation<DocumentCreateResult, DocumentCreateRequest>(
    "create-document",
    {
      skipActionQueryInvalidation: true,
      onSuccess: (created) =>
        invalidateContentQueries(
          queryClient,
          contentPlacementTargets(queryClient, {
            documentIds: [created.id],
            parentIds: [created.parentId ?? null],
            databaseId: created.parentId
              ? undefined
              : contentSpaceFilesDatabaseId(queryClient, created.spaceId),
          }),
        ),
    },
  );
}

const DOCUMENT_UPDATE_MUTATION_KEY = ["content", "update-document"];
const recentSaveRecoveries = new WeakMap<QueryClient, () => void>();

function recoverRecentAfterDocumentSaves(queryClient: QueryClient) {
  if (recentSaveRecoveries.has(queryClient)) return;
  let reading = false;
  const stopRecovery = () => {
    recentSaveRecoveries.get(queryClient)?.();
    recentSaveRecoveries.delete(queryClient);
  };
  const reconcile = () => {
    if (reading) return;
    if (
      queryClient.isMutating({
        mutationKey: DOCUMENT_UPDATE_MUTATION_KEY,
        predicate: (mutation) => {
          const pending = mutation.state.variables as
            | DocumentUpdateRequestWithCas
            | undefined;
          return pending?.title !== undefined || pending?.icon !== undefined;
        },
      }) > 0
    )
      return;
    reading = true;
    const refresh = queryClient.invalidateQueries(
      { queryKey: ["action", "get-content-recent"] },
      { throwOnError: true },
    );
    const reads = queryClient
      .getQueryCache()
      .findAll({ queryKey: ["action", "get-content-recent"], type: "active" })
      .map((query) => query.promise);
    void Promise.all([refresh, ...reads]).then(
      stopRecovery,
      (error: unknown) => {
        reading = false;
        if (isCancelledError(error)) reconcile();
        else stopRecovery();
      },
    );
  };
  recentSaveRecoveries.set(
    queryClient,
    // Mutation statuses change after onSettled, including simultaneous failures.
    queryClient.getMutationCache().subscribe(reconcile),
  );
  reconcile();
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
      mutationKey: DOCUMENT_UPDATE_MUTATION_KEY,
      skipActionQueryInvalidation: true,
      onMutate: async (variables) => {
        // This tab's own saves never come back through sync.
        spoilPageOpenReads(queryClient, variables.id);
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
        const recentFilter = {
          queryKey: ["action", "get-content-recent"],
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
          queryClient.cancelQueries(recentFilter),
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
        if (variables.title !== undefined || variables.icon !== undefined)
          recoverRecentAfterDocumentSaves(queryClient);
      },
      onSettled: (_data, _error, variables) => {
        spoilPageOpenReads(queryClient, variables.id);
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
        if (
          isDocumentUpdateConflict(data) ||
          isDocumentUpdateSuperseded(data) ||
          isDocumentUpdatePreservationRequired(data)
        ) {
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
          invalidateContentQueries(queryClient, [
            contentDatabaseConstrainedQueryFilter(),
            ...contentRowTargets(queryClient, [variables.id]),
            ["action", "search-documents"],
          ]);
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
          invalidateContentQueries(queryClient, [
            contentNavigationBranchFilter({ documentIds: [variables.id] }),
          ]);
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

const TRASH_LIST_QUERY_KEYS: readonly ContentQueryTarget[] = [
  ["action", "list-trashed-documents"],
  ["action", "list-trashed-content-databases"],
  ["action", "list-content-trash"],
];

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useContentActionMutation<
    {
      success: boolean;
      deleted: number;
      removed?: number;
      activeTargetDeleted?: boolean;
      navigationPath?: string | null;
    },
    { id: string; databaseDocumentId?: string; activeDocumentId?: string }
  >("delete-document", {
    invalidates: (_data, variables) => [
      ...contentPlacementTargets(queryClient, { documentIds: [variables.id] }),
      contentDatabaseItemsContainingDocumentFilter(variables.id),
      documentQueryFilter(variables.id),
      ["action", "list-documents"],
      ["action", "get-content-database"],
      ["action", "list-content-spaces"],
      ["action", "get-content-recent"],
      ["action", "search-documents"],
      ...TRASH_LIST_QUERY_KEYS,
    ],
  });
}

export function useRollbackCreatedSlashDocument() {
  const queryClient = useQueryClient();
  return useContentActionMutation<
    {
      success: boolean;
      id: string;
      disposition: "trashed" | "absent";
      deletedIds: string[];
    },
    { id: string; parentId: string }
  >("rollback-created-slash-document", {
    invalidates: (_result, { id, parentId }) => [
      ...contentPlacementTargets(queryClient, {
        documentIds: [id],
        parentIds: [parentId],
      }),
      documentQueryFilter(id),
      ["action", "list-documents"],
      ["action", "get-content-database"],
      ...TRASH_LIST_QUERY_KEYS,
    ],
  });
}

export function useTrashedDocuments(options?: { enabled?: boolean }) {
  return useActionQuery<ListTrashedDocumentsResponse>(
    "list-trashed-documents",
    {},
    { enabled: options?.enabled !== false },
  );
}

/** A restored page returns to a parent the client does not know, so every mounted branch refreshes. */
export function restoredDocumentTargets(
  documentId: string,
): ContentQueryTarget[] {
  return [
    contentDatabaseNavigationQueryFilter(),
    contentNavigationContextFilter([documentId]),
    documentScopedQueryFilter(documentId),
    contentDatabaseConstrainedQueryFilter(),
    ["action", "list-documents"],
    ["action", "get-content-database"],
    ["action", "get-content-recent"],
    ["action", "search-documents"],
    ...TRASH_LIST_QUERY_KEYS,
  ];
}

export function useRestoreDocument() {
  return useContentActionMutation<
    { success: boolean; restored: number; documentId: string },
    { id: string }
  >("restore-document", {
    invalidates: (_data, { id }) => restoredDocumentTargets(id),
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
    onSuccess: (_data, { id }) => {
      invalidateContentQueries(queryClient, [
        documentScopedQueryFilter(id),
        ["action", "list-documents"],
        ...TRASH_LIST_QUERY_KEYS,
      ]);
    },
  });
}

export function useMoveDocument() {
  const queryClient = useQueryClient();
  return useContentActionMutation<
    Document,
    DocumentMoveRequest & { id: string }
  >("move-document", {
    invalidates: (_data, variables) => [
      ...contentPlacementTargets(queryClient, {
        documentIds: [variables.id],
        parentIds: variables.parentId === undefined ? [] : [variables.parentId],
        databaseId: variables.spaceId
          ? contentSpaceFilesDatabaseId(queryClient, variables.spaceId)
          : undefined,
      }),
      documentQueryFilter(variables.id),
      contentFilesCollectionFilter(),
      ["action", "list-documents"],
      ...(variables.spaceId
        ? [
            ["action", "get-content-database"],
            ["action", "get-content-recent"],
          ]
        : []),
    ],
  });
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
