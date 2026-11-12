import { callActionWithRetry } from "@agent-native/core/client/hooks";
import {
  runActionQueryRead,
  useActionQueryCanFetch,
} from "@agent-native/core/client/use-action";
import {
  safeParseIconValue,
  serializeIconValue,
} from "@agent-native/core/icons";
import type {
  ContentDatabaseNavigationItem,
  ContentDatabaseNavigationPage,
  ContentDatabaseNavigationPageResponse,
  ContentDatabasePersonalViewOverrides,
  ContentDatabaseUnavailableResponse,
  ContentSidebarViewOrder,
  Document,
} from "@shared/api";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { isDocumentCreationPending } from "./optimistic-document";

export const FILES_NAVIGATION_PAGE_SIZE = 20;

// Most expanded folders one read asks for; the server caps what it returns.
const MAX_EXPANDED_IDS_PER_READ = 100;
const pendingExpansionReads = new WeakMap<QueryClient, Set<string>>();

/**
 * The folders the Files tree draws open, most important first: both caps on
 * the folders one read opens keep the first ones, so the open page's
 * ancestors come before the folders a person expanded.
 */
export function openFilesFolderIds(
  activeAncestorIds: Iterable<string>,
  expandedDocumentIds: Iterable<string>,
): ReadonlySet<string> {
  return new Set([...activeAncestorIds, ...expandedDocumentIds]);
}

/** The Files tree order a person chose, as the paged navigation query reads it. */
export function filesNavigationOrder(
  overrides: ContentDatabasePersonalViewOverrides | null | undefined,
): { activeViewId: string; order: ContentSidebarViewOrder } {
  const activeViewId = overrides?.activeViewId ?? "default";
  return {
    activeViewId,
    order: overrides?.views.find((view) => view.id === activeViewId)
      ?.sidebarOrder ?? { mode: "custom", itemIds: [] },
  };
}

// Every reader of one Files branch must build the same params so the sidebar
// tree and breadcrumb menus share one cached request per page. Every reader
// must also read it through `useFilesNavigationPage`: a query refetches with
// the read function of whichever reader mounted last, so a reader with its own
// function would drop this tab's new pages and the expanded folders the shared
// read loads with the branch. The server orders a branch by the person's saved
// view, so the order is not part of the key: a branch can be read before that
// view arrives.
export function filesNavigationPageParams(args: {
  databaseId: string;
  parentId: string | null;
  cursor?: string;
}) {
  return {
    databaseId: args.databaseId,
    limit: FILES_NAVIGATION_PAGE_SIZE,
    navigation: { parentId: args.parentId, cursor: args.cursor },
  };
}

export type FilesNavigationPageParams = ReturnType<
  typeof filesNavigationPageParams
>;

export function filesNavigationQueryKey(params: FilesNavigationPageParams) {
  return ["action", "query-content-database-items", params] as const;
}

type FilesNavigationRead =
  | ContentDatabaseNavigationPageResponse
  | ContentDatabaseUnavailableResponse;

// Pages this tab created, by page ID. The server lists a page only once its
// create commits, and lists a new page last, after the first page of a branch
// longer than one page. Each read of a branch's first page keeps these rows at
// its end, so a new page stays in the sidebar while its create is in flight,
// when another create or a move rereads the branch, and after the person opens
// another page.
type CreatedFilesRow = {
  databaseId: string;
  item: ContentDatabaseNavigationItem;
  /** The mark taken when the create's answer arrived; null while in flight. */
  confirmedMark: number | null;
};

// Orders this tab's Files reads and create answers. A counter, not the clock:
// a read that starts in the same millisecond as an answer would count as
// starting after it, and could drop a row the read never had a chance to list.
let lastFilesMark = 0;
const nextFilesMark = () => ++lastFilesMark;

const createdFilesRows = new WeakMap<
  QueryClient,
  Map<string, CreatedFilesRow>
>();
const CREATED_ROW_MEMBERSHIP_PREFIX = "created-";

function isCreatedRow(item: ContentDatabaseNavigationItem) {
  return item.membershipId.startsWith(CREATED_ROW_MEMBERSHIP_PREFIX);
}

/** Rewrites cached Files pages; `update` returns undefined to leave one as is. */
function updateCachedFilesPages(
  queryClient: QueryClient,
  update: (
    page: ContentDatabaseNavigationPage,
    params: FilesNavigationPageParams,
  ) => ContentDatabaseNavigationPage | undefined,
) {
  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: ["action", "query-content-database-items"] })) {
    const params = query.queryKey[2] as FilesNavigationPageParams | undefined;
    const page = query.state.data as FilesNavigationRead | undefined;
    if (!params?.navigation || !page || "available" in page) continue;
    const next = update(page, params);
    if (!next) continue;
    // A written page keeps the time of its last read, so it rereads when it
    // would have; one already marked stale still rereads when it next draws.
    const stale = query.state.isInvalidated;
    queryClient.setQueryData(query.queryKey, next, {
      updatedAt: query.state.dataUpdatedAt,
    });
    if (stale) {
      void queryClient.invalidateQueries({
        queryKey: query.queryKey,
        exact: true,
        refetchType: "none",
      });
    }
  }
}

/**
 * Shows a page this tab is creating at the end of its Files branch until the
 * server lists it. A page whose create already committed (one restored after
 * a reload) counts as confirmed now.
 */
export function showCreatedFilesRow(
  queryClient: QueryClient,
  databaseId: string,
  document: Document,
  type: ContentDatabaseNavigationItem["type"] = "page",
) {
  let rows = createdFilesRows.get(queryClient);
  if (!rows) {
    rows = new Map();
    createdFilesRows.set(queryClient, rows);
  }
  const icon = safeParseIconValue(document.icon ?? null);
  const item: ContentDatabaseNavigationItem = {
    membershipId: `${CREATED_ROW_MEMBERSHIP_PREFIX}${document.id}`,
    membershipPosition: document.position,
    documentId: document.id,
    parentId: document.parentId ?? null,
    title: document.title,
    icon: icon.success ? serializeIconValue(icon.data) : null,
    type,
    hasChildren: false,
    spaceId: document.spaceId ?? null,
    sourceKind: document.source?.kind ?? null,
    isFavorite: document.isFavorite,
    canEdit: document.canEdit !== false,
    canManage: document.canManage !== false,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
  rows.set(document.id, {
    databaseId,
    item,
    confirmedMark: isDocumentCreationPending(queryClient, document)
      ? null
      : nextFilesMark(),
  });
  updateCachedFilesPages(queryClient, (page, params) =>
    params.databaseId === databaseId &&
    params.navigation.parentId === item.parentId &&
    params.navigation.cursor === undefined &&
    !page.items.some((listed) => listed.documentId === document.id)
      ? { ...page, items: [...page.items, item] }
      : undefined,
  );
}

/**
 * The server answered a create: a read that starts from now on lists the page
 * if it is still in its branch's first page.
 */
export function confirmCreatedFilesRow(
  queryClient: QueryClient,
  documentId: string,
) {
  const row = createdFilesRows.get(queryClient)?.get(documentId);
  if (row) row.confirmedMark ??= nextFilesMark();
}

/**
 * A page this tab is still creating: the server doesn't have it yet, so
 * nothing can be moved into it.
 */
export function isFilesRowCreationPending(
  queryClient: QueryClient,
  documentId: string,
) {
  return (
    createdFilesRows.get(queryClient)?.get(documentId)?.confirmedMark === null
  );
}

/**
 * Stops keeping pages in their branches, for a page deleted or moved: the
 * write's own reread of the branch then draws what the server has.
 */
export function forgetCreatedFilesRows(
  queryClient: QueryClient,
  documentIds: Iterable<string>,
) {
  const rows = createdFilesRows.get(queryClient);
  if (!rows) return;
  for (const documentId of documentIds) rows.delete(documentId);
}

/**
 * Takes pages out of the sidebar whose create failed or was discarded. The
 * server never had them, so no reread would remove their rows.
 */
export function removeCreatedFilesRows(
  queryClient: QueryClient,
  documentIds: Iterable<string>,
) {
  if (!createdFilesRows.has(queryClient)) return;
  const removed = new Set(documentIds);
  forgetCreatedFilesRows(queryClient, removed);
  updateCachedFilesPages(queryClient, (page) =>
    page.items.some(
      (item) => removed.has(item.documentId) && isCreatedRow(item),
    )
      ? {
          ...page,
          items: page.items.filter(
            (item) => !(removed.has(item.documentId) && isCreatedRow(item)),
          ),
        }
      : undefined,
  );
}

/**
 * Adds this tab's new pages to a page the server just read. A row leaves once
 * a read that started after its create was confirmed lists it, or reads its
 * whole branch without it (the page was deleted or moved). In a branch longer
 * than one page it stays at the end of the first page, where the person last
 * saw it.
 */
function withCreatedFilesRows(
  queryClient: QueryClient,
  params: FilesNavigationPageParams,
  page: ContentDatabaseNavigationPage,
  readStartMark: number,
): ContentDatabaseNavigationPage {
  const rows = createdFilesRows.get(queryClient);
  if (!rows?.size) return page;
  const { databaseId, navigation } = params;
  const firstPage = navigation.cursor === undefined;
  const listed = new Set(page.items.map((item) => item.documentId));
  // A shown row keeps the title and icon given to it since it was added.
  const cached = firstPage
    ? queryClient.getQueryData<FilesNavigationRead>(
        filesNavigationQueryKey(params),
      )
    : undefined;
  const cachedItems = cached && !("available" in cached) ? cached.items : [];
  const parentIds = new Set<string | null>();
  const shown: ContentDatabaseNavigationItem[] = [];
  for (const [documentId, row] of rows) {
    if (row.databaseId !== databaseId) continue;
    parentIds.add(row.item.parentId);
    if (!firstPage || row.item.parentId !== navigation.parentId) continue;
    const readAfterCreate =
      row.confirmedMark !== null && row.confirmedMark < readStartMark;
    if (listed.has(documentId)) {
      if (readAfterCreate) rows.delete(documentId);
      continue;
    }
    if (readAfterCreate && !page.pagination.hasMore) {
      rows.delete(documentId);
      continue;
    }
    row.item =
      cachedItems.find((item) => item.documentId === documentId) ?? row.item;
    shown.push(row.item);
  }
  const items = [...page.items, ...shown];
  // A folder whose first child is still being created has children already.
  const withChildren = items.map((item) =>
    parentIds.has(item.documentId) && !item.hasChildren
      ? { ...item, hasChildren: true }
      : item,
  );
  return shown.length > 0 ||
    withChildren.some((item, index) => item !== items[index])
    ? { ...page, items: withChildren }
    : page;
}

/**
 * The top-level rows of every Files tree this browser has read, in tree
 * order, with the tree that holds `documentId` first.
 */
export function cachedFilesRootDocumentIds(
  queryClient: Pick<QueryClient, "getQueriesData">,
  documentId: string,
): string[] {
  const roots = queryClient
    .getQueriesData<FilesNavigationRead>({
      queryKey: ["action", "query-content-database-items"],
      predicate: ({ queryKey }) => {
        const params = queryKey[2] as
          | Partial<FilesNavigationPageParams>
          | undefined;
        return (
          params?.navigation?.parentId === null &&
          params.navigation.cursor === undefined
        );
      },
    })
    .flatMap(([, data]) =>
      data && !("available" in data)
        ? [data.items.map((item) => item.documentId)]
        : [],
    );
  return [
    ...roots.filter((ids) => ids.includes(documentId)),
    ...roots.filter((ids) => !ids.includes(documentId)),
  ].flat();
}

/**
 * Reads one Files page and asks for any expanded folders that do not have a
 * cached page yet, so opening a cached root can still load its new branches.
 */
export async function readFilesNavigationPage(
  queryClient: QueryClient,
  params: FilesNavigationPageParams,
  expanded: Iterable<string>,
  signal?: AbortSignal,
): Promise<FilesNavigationRead> {
  const expand = [...expanded]
    .filter((parentId) => {
      const key = filesNavigationQueryKey(
        filesNavigationPageParams({
          databaseId: params.databaseId,
          parentId,
        }),
      );
      return queryClient.getQueryData(key) === undefined;
    })
    .slice(0, MAX_EXPANDED_IDS_PER_READ);
  const expansionKey =
    expand.length > 0 ? JSON.stringify([params.databaseId, expand]) : null;
  let pending: Set<string> | undefined;
  if (expansionKey) {
    pending = pendingExpansionReads.get(queryClient);
    if (!pending) {
      pending = new Set();
      pendingExpansionReads.set(queryClient, pending);
    }
    pending.add(expansionKey);
  }
  const readStartMark = nextFilesMark();
  try {
    // Read like a `useActionQuery`: a refused read drops the rows this page
    // showed. The Files tree isn't saved in the browser, so the response
    // isn't offered to the saved results.
    const response = await runActionQueryRead(
      queryClient,
      filesNavigationQueryKey(params),
      signal,
      () =>
        callActionWithRetry<FilesNavigationRead>(
          "query-content-database-items",
          expand.length
            ? { ...params, navigation: { ...params.navigation, expand } }
            : params,
          { method: "GET", ...(signal ? { signal } : {}) },
        ),
    );
    // A read stopped after its answer arrived, as when the tree's top level
    // was just refused, seeds nothing.
    signal?.throwIfAborted();
    if ("available" in response) return response;
    // A folder left out of `branches`, whether the cap dropped it
    // (`branchesTruncated`) or it has no children to show, is not seeded as
    // empty: it reads its own page when it draws.
    const { branches, branchesTruncated, ...page } = response;
    for (const [parentId, branch] of Object.entries(branches ?? {})) {
      const branchParams = filesNavigationPageParams({
        databaseId: params.databaseId,
        parentId,
      });
      const key = filesNavigationQueryKey(branchParams);
      // A folder that already has its own page keeps it; that read is the
      // one its later changes refresh.
      if (queryClient.getQueryData(key) === undefined) {
        queryClient.setQueryData(
          key,
          withCreatedFilesRows(
            queryClient,
            branchParams,
            branch,
            readStartMark,
          ),
        );
      }
    }
    return withCreatedFilesRows(queryClient, params, page, readStartMark);
  } catch (error) {
    // A refused read of the tree's top level means the whole Files database
    // is out of reach, so every page of it this tab cached goes too, such as
    // a folder's page a breadcrumb menu still draws.
    const status = (error as { status?: unknown } | undefined)?.status;
    if (
      !signal?.aborted &&
      params.navigation.parentId === null &&
      (status === 401 || status === 403 || status === 404)
    ) {
      clearCachedFilesPages(
        queryClient,
        params.databaseId,
        filesNavigationQueryKey(params),
      );
    }
    throw error;
  } finally {
    if (expansionKey && pending) pending.delete(expansionKey);
  }
}

function clearCachedFilesPages(
  queryClient: QueryClient,
  databaseId: string,
  refusedKey: QueryKey,
) {
  const cache = queryClient.getQueryCache();
  const refused = cache.find({ queryKey: refusedKey, exact: true });
  for (const query of cache.findAll({
    queryKey: ["action", "query-content-database-items"],
  })) {
    const params = query.queryKey[2] as FilesNavigationPageParams | undefined;
    if (!params?.navigation || params.databaseId !== databaseId) continue;
    // A read still under way would put back what this clears once it
    // answers, so it stops first. The refused read is the one ending here.
    if (query !== refused && query.state.fetchStatus !== "idle") {
      void query.cancel({ revert: true });
    }
    query.setState({ data: undefined, dataUpdatedAt: 0 });
  }
}

function isExpansionReadPending(
  queryClient: QueryClient,
  databaseId: string,
  expanded: Iterable<string>,
) {
  const expand = [...expanded]
    .filter((parentId) => {
      const key = filesNavigationQueryKey(
        filesNavigationPageParams({ databaseId, parentId }),
      );
      return queryClient.getQueryData(key) === undefined;
    })
    .slice(0, MAX_EXPANDED_IDS_PER_READ);
  if (expand.length === 0) return false;
  return (
    pendingExpansionReads
      .get(queryClient)
      ?.has(JSON.stringify([databaseId, expand])) ?? false
  );
}

const NO_EXPANDED_FOLDERS: ReadonlySet<string> = new Set();

// The folders each mounted sidebar draws open under a Files page it reads. Every
// reader asks for all of these, its own first, so a reread asks for the same
// folders whichever reader mounted last, such as a breadcrumb menu or the
// second of two sidebars.
const openFoldersByPage = new WeakMap<
  QueryClient,
  Map<string, Set<{ folders: ReadonlySet<string> }>>
>();

function openFoldersOnPage(
  queryClient: QueryClient,
  pageKey: string,
  expanded: ReadonlySet<string>,
) {
  const open = new Set(expanded);
  for (const { folders } of openFoldersByPage.get(queryClient)?.get(pageKey) ??
    [])
    for (const folder of folders) open.add(folder);
  return open;
}

export function useFilesNavigationPage(
  params: FilesNavigationPageParams,
  expanded: ReadonlySet<string> = NO_EXPANDED_FOLDERS,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const queryKey = filesNavigationQueryKey(params);
  const canFetch = useActionQueryCanFetch(queryKey);
  const pageKey = JSON.stringify(queryKey);
  const expansionKey = JSON.stringify([
    params.databaseId,
    params.navigation.parentId,
    params.navigation.cursor ?? null,
    [...expanded],
  ]);
  const rootReadExpansion = useRef<string | null>(null);
  useEffect(() => {
    if (expanded.size === 0) return;
    let pages = openFoldersByPage.get(queryClient);
    if (!pages) {
      pages = new Map();
      openFoldersByPage.set(queryClient, pages);
    }
    let readers = pages.get(pageKey);
    if (!readers) {
      readers = new Set();
      pages.set(pageKey, readers);
    }
    const reader = { folders: expanded };
    readers.add(reader);
    return () => {
      readers.delete(reader);
      if (readers.size === 0 && pages.get(pageKey) === readers)
        pages.delete(pageKey);
    };
  }, [expanded, pageKey, queryClient]);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => {
      rootReadExpansion.current = expansionKey;
      return readFilesNavigationPage(
        queryClient,
        params,
        openFoldersOnPage(queryClient, pageKey, expanded),
        signal,
      );
    },
    retry: false,
    enabled: enabled && canFetch,
  });
  useEffect(() => {
    if (
      !query.data ||
      "available" in query.data ||
      query.isFetching ||
      isExpansionReadPending(queryClient, params.databaseId, expanded) ||
      rootReadExpansion.current === expansionKey
    ) {
      return;
    }
    const hasMissingBranch = [...expanded].some((parentId) => {
      const key = filesNavigationQueryKey(
        filesNavigationPageParams({
          databaseId: params.databaseId,
          parentId,
        }),
      );
      return queryClient.getQueryData(key) === undefined;
    });
    if (!hasMissingBranch) {
      rootReadExpansion.current = expansionKey;
      return;
    }
    void query.refetch();
  }, [
    expanded,
    expansionKey,
    params,
    query.data,
    query.isFetching,
    query.refetch,
    queryClient,
  ]);
  return query;
}
