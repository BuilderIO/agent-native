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
import { isLocalSourceDirectoryId } from "@shared/local-source-directory";
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
type PendingPagesOnlyRead = {
  databaseId: string;
  parentId: string | null;
  readStartMark: number;
  retained: Map<string, { row: CreatedFilesRow; readMark: number }>;
  movedOut: Set<string>;
};
const pendingPagesOnlyReads = new WeakMap<
  QueryClient,
  Set<PendingPagesOnlyRead>
>();

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
  pagesOnly?: boolean;
  group?: string;
  locate?: string;
}) {
  return {
    databaseId: args.databaseId,
    limit: FILES_NAVIGATION_PAGE_SIZE,
    navigation: {
      parentId: args.parentId,
      cursor: args.cursor,
      ...(args.pagesOnly ? { pagesOnly: true } : {}),
      ...(args.group === undefined ? {} : { group: args.group }),
      ...(args.locate === undefined ? {} : { locate: args.locate }),
    },
  };
}

export type FilesNavigationPageParams = ReturnType<
  typeof filesNavigationPageParams
>;

export function filesNavigationQueryKey(params: FilesNavigationPageParams) {
  return ["action", "query-content-database-items", params] as const;
}

function listsBranch({ navigation }: FilesNavigationPageParams) {
  return navigation.group === undefined && navigation.locate === undefined;
}

type FilesNavigationRead =
  | ContentDatabaseNavigationPageResponse
  | ContentDatabaseUnavailableResponse;

// Pages this tab created, by page ID, and pages it moved into a new branch.
// The server lists a page only once its create commits, and lists a new page
// last, after the first page of a branch longer than one page. Each read of a
// branch's first page keeps these rows at its end, so a new page stays in the
// sidebar while its create is in flight, when another create or a move rereads
// the branch, and after the person opens another page. A moved page stays the
// same way through a read that started before its move committed.
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
const filesReadMarks = new WeakMap<object, number>();

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
    listsBranch(params) &&
    params.navigation.parentId === item.parentId &&
    params.navigation.cursor === undefined &&
    (!params.navigation.pagesOnly || item.type === "page") &&
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
  for (const documentId of documentIds) {
    rows?.delete(documentId);
    for (const read of pendingPagesOnlyReads.get(queryClient) ?? []) {
      read.retained.delete(documentId);
      read.movedOut.add(documentId);
    }
  }
}

/**
 * The server moved a page: reads of its new branch keep it at the end of the
 * first page, as for a page this tab created, until a read that started from
 * now on lists it or reads the whole branch without it.
 */
export function keepMovedFilesRow(
  queryClient: QueryClient,
  move: FilesRowMove,
) {
  let rows = createdFilesRows.get(queryClient);
  if (!rows) {
    rows = new Map();
    createdFilesRows.set(queryClient, rows);
  }
  for (const read of pendingPagesOnlyReads.get(queryClient) ?? []) {
    read.retained.delete(move.documentId);
    if (read.databaseId === move.databaseId && read.parentId === move.parentId)
      read.movedOut.delete(move.documentId);
    else read.movedOut.add(move.documentId);
  }
  rows.set(move.documentId, {
    databaseId: move.databaseId,
    item: move.item,
    confirmedMark: nextFilesMark(),
  });
}

/**
 * The pages this tab keeps at the end of a branch's first page, created there
 * or moved in, for a branch whose first read hasn't landed: its read keeps
 * the same rows, so they show while it loads.
 */
export function keptFilesRows(
  queryClient: QueryClient,
  databaseId: string,
  parentId: string | null,
): ContentDatabaseNavigationItem[] {
  const rows = createdFilesRows.get(queryClient);
  if (!rows) return [];
  return [...rows.values()].flatMap((row) =>
    row.databaseId === databaseId && row.item.parentId === parentId
      ? [row.item]
      : [],
  );
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
  pendingRead?: PendingPagesOnlyRead,
): ContentDatabaseNavigationPage {
  if (pendingRead?.movedOut.size) {
    page = {
      ...page,
      items: page.items.filter(
        (item) => !pendingRead.movedOut.has(item.documentId),
      ),
    };
  }
  const { databaseId, navigation } = params;
  if (
    listsBranch(params) &&
    navigation.cursor === undefined &&
    !page.pagination.hasMore
  ) {
    const listed = new Set(page.items.map((item) => item.documentId));
    for (const read of pendingPagesOnlyReads.get(queryClient) ?? []) {
      if (
        read.databaseId !== databaseId ||
        read.parentId !== navigation.parentId
      )
        continue;
      for (const [id, retained] of read.retained) {
        if (
          retained.readMark < readStartMark &&
          !listed.has(id) &&
          (!navigation.pagesOnly || retained.row.item.type === "page")
        ) {
          read.retained.delete(id);
          read.movedOut.add(id);
        }
      }
    }
  }
  const liveRows = createdFilesRows.get(queryClient);
  const rows = pendingRead
    ? new Map([
        ...Array.from(
          pendingRead.retained,
          ([id, retained]) => [id, retained.row] as const,
        ),
        ...(liveRows ?? []),
      ])
    : liveRows;
  if (!rows?.size || !listsBranch(params)) return page;
  const retire = (
    documentId: string,
    row: CreatedFilesRow,
    present: boolean,
  ) => {
    if (navigation.pagesOnly && present) return;
    for (const read of pendingPagesOnlyReads.get(queryClient) ?? []) {
      if (
        read.databaseId !== databaseId ||
        read.parentId !== row.item.parentId ||
        read.readStartMark >= readStartMark
      )
        continue;
      if (!present) {
        read.retained.delete(documentId);
        read.movedOut.add(documentId);
      } else if (!read.movedOut.has(documentId)) {
        read.retained.set(documentId, { row, readMark: readStartMark });
      }
    }
    liveRows?.delete(documentId);
  };
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
    if (
      !firstPage ||
      row.item.parentId !== navigation.parentId ||
      (navigation.pagesOnly && row.item.type !== "page")
    )
      continue;
    const retained = pendingRead?.retained.get(documentId);
    const readAfterCreate =
      row.confirmedMark !== null &&
      row.confirmedMark < readStartMark &&
      !(retained?.row === row && retained.readMark > readStartMark);
    if (listed.has(documentId)) {
      if (readAfterCreate) retire(documentId, row, true);
      continue;
    }
    if (readAfterCreate && !page.pagination.hasMore) {
      retire(documentId, row, false);
      continue;
    }
    const item =
      cachedItems.find((item) => item.documentId === documentId) ?? row.item;
    if (!navigation.pagesOnly) row.item = item;
    shown.push(item);
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

/** A page's row in a cached Files page, and the Files collection that lists it. */
export function cachedFilesRow(
  queryClient: Pick<QueryClient, "getQueryCache">,
  documentId: string,
): { databaseId: string; item: ContentDatabaseNavigationItem } | undefined {
  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: ["action", "query-content-database-items"] })) {
    const params = query.queryKey[2] as FilesNavigationPageParams | undefined;
    const page = query.state.data as FilesNavigationRead | undefined;
    if (!params?.navigation || !page || "available" in page) continue;
    const item = [
      ...page.items,
      ...(page.groups ?? []).flatMap((group) => group.page.items),
    ].find((candidate) => candidate.documentId === documentId);
    if (item) return { databaseId: params.databaseId, item };
  }
  return undefined;
}

/** The page a Files row stands for, as far as the row knows it. */
export function filesRowDocument(
  item: ContentDatabaseNavigationItem,
): Document {
  return {
    id: item.documentId,
    spaceId: item.spaceId,
    parentId: item.parentId,
    title: item.title,
    content: "",
    icon: item.icon,
    position: item.membershipPosition,
    isFavorite: item.isFavorite,
    hideFromSearch: false,
    canEdit: item.canEdit,
    canManage: item.canManage,
    ...(item.type === "folder"
      ? { source: { mode: "local-files", kind: "folder" } }
      : item.sourceKind
        ? { source: { mode: "database", kind: item.sourceKind } }
        : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/** A page on its way to a new parent, as the Files tree draws it there. */
export type FilesRowMove = {
  documentId: string;
  /** The Files collection the page moves into. */
  databaseId: string;
  parentId: string | null;
  /** Where the tree showed it before the move. */
  from: { databaseId: string; parentId: string | null };
  /** Its row under the new parent. */
  item: ContentDatabaseNavigationItem;
};

/** The move a page on its way to `parentId` makes, read from its cached row. */
export function filesRowMove(
  queryClient: Pick<QueryClient, "getQueryCache">,
  {
    documentId,
    parentId,
    databaseId,
  }: {
    documentId: string;
    parentId: string | null;
    /** The Files collection of another space; the page's own by default. */
    databaseId?: string | undefined;
  },
): FilesRowMove | undefined {
  const row = cachedFilesRow(queryClient, documentId);
  if (!row) return undefined;
  return {
    documentId,
    databaseId: databaseId ?? row.databaseId,
    parentId,
    from: { databaseId: row.databaseId, parentId: row.item.parentId },
    item: { ...row.item, parentId },
  };
}

/**
 * Draws a page the server just moved in its new place in every cached Files
 * page: gone from the branch it left, at the end of its new branch's first
 * page, under a parent that now has children, and out of an old parent left
 * with none. The move's own reread of those branches then draws the server's
 * order. That reread finds the branches by the page's cached rows, so this
 * runs after it starts, and a page it marked stale stays marked.
 */
export function moveCachedFilesRow(
  queryClient: QueryClient,
  move: FilesRowMove,
) {
  const inDestination = (params: FilesNavigationPageParams) =>
    params.databaseId === move.databaseId &&
    (!listsBranch(params) || params.navigation.parentId === move.parentId);
  updateCachedFilesPages(queryClient, (page, params) => {
    const listed = page.items.some(
      (item) => item.documentId === move.documentId,
    );
    if (listed && !inDestination(params)) {
      return {
        ...page,
        items: page.items.filter((item) => item.documentId !== move.documentId),
      };
    }
    return !listed &&
      listsBranch(params) &&
      inDestination(params) &&
      params.navigation.cursor === undefined &&
      (!params.navigation.pagesOnly || move.item.type === "page")
      ? { ...page, items: [...page.items, move.item] }
      : undefined;
  });
  updateCachedFilesPages(queryClient, (page, params) => {
    const { groups } = page as ContentDatabaseNavigationPageResponse;
    if (
      params.databaseId === move.databaseId ||
      !groups?.some((group) =>
        group.page.items.some((item) => item.documentId === move.documentId),
      )
    ) {
      return undefined;
    }
    const next: ContentDatabaseNavigationPageResponse = {
      ...page,
      groups: groups.map((group) => ({
        ...group,
        page: {
          ...group.page,
          items: group.page.items.filter(
            (item) => item.documentId !== move.documentId,
          ),
        },
      })),
    };
    return next;
  });
  const oldParentId = move.from.parentId;
  const oldBranch =
    oldParentId === null
      ? undefined
      : queryClient.getQueryData<FilesNavigationRead>(
          filesNavigationQueryKey(
            filesNavigationPageParams({
              databaseId: move.from.databaseId,
              parentId: oldParentId,
            }),
          ),
        );
  const oldParentEmptied =
    oldBranch !== undefined &&
    !("available" in oldBranch) &&
    oldBranch.items.length === 0 &&
    !oldBranch.pagination.hasMore;
  const hasChildrenAfterMove = (item: ContentDatabaseNavigationItem) =>
    item.documentId === move.parentId
      ? true
      : oldParentEmptied && item.documentId === oldParentId
        ? false
        : item.hasChildren;
  updateCachedFilesPages(queryClient, (page) =>
    page.items.some((item) => hasChildrenAfterMove(item) !== item.hasChildren)
      ? {
          ...page,
          items: page.items.map((item) => ({
            ...item,
            hasChildren: hasChildrenAfterMove(item),
          })),
        }
      : undefined,
  );
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
          params.navigation.cursor === undefined &&
          params.navigation.pagesOnly !== true
        );
      },
    })
    .flatMap(([, data]) =>
      data && !("available" in data)
        ? [
            data.items.flatMap((item) =>
              item.type === "folder" ? [] : [item.documentId],
            ),
          ]
        : [],
    );
  return [
    ...roots.filter((ids) => ids.includes(documentId)),
    ...roots.filter((ids) => !ids.includes(documentId)),
  ].flat();
}

export function cachedFilesSiblingDocumentIds(
  queryClient: Pick<QueryClient, "getQueriesData">,
  documentId: string,
  activePath: readonly {
    id: string;
    parentId: string | null;
    databaseId: string | null;
  }[],
): string[] {
  const entry = activePath.find((candidate) => candidate.id === documentId);
  const parentId = entry?.parentId;
  const databaseId = entry?.databaseId;
  if (!databaseId || !parentId || !isLocalSourceDirectoryId(parentId)) {
    return [];
  }
  const siblings = queryClient
    .getQueriesData<FilesNavigationRead>({
      queryKey: ["action", "query-content-database-items"],
      predicate: ({ queryKey }) => {
        const params = queryKey[2] as
          | Partial<FilesNavigationPageParams>
          | undefined;
        return (
          params?.databaseId === databaseId &&
          params.navigation?.parentId === parentId &&
          params.navigation.pagesOnly !== true
        );
      },
    })
    .flatMap(([, data]) =>
      data && !("available" in data)
        ? data.items.flatMap((item) =>
            item.type === "folder" || item.documentId === documentId
              ? []
              : [item.documentId],
          )
        : [],
    );
  return [...new Set(siblings)];
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
  const pagesOnly = params.navigation.pagesOnly === true;
  const expand = [...(pagesOnly ? [] : expanded)]
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
  const currentQuery = queryClient.getQueryCache().find({
    queryKey: filesNavigationQueryKey(params),
    exact: true,
  });
  if (currentQuery) filesReadMarks.set(currentQuery, readStartMark);
  let pendingPageReads: Set<PendingPagesOnlyRead> | undefined;
  let pendingRead: PendingPagesOnlyRead | undefined;
  if (pagesOnly) {
    pendingPageReads = pendingPagesOnlyReads.get(queryClient);
    if (!pendingPageReads) {
      pendingPageReads = new Set();
      pendingPagesOnlyReads.set(queryClient, pendingPageReads);
    }
    pendingRead = {
      databaseId: params.databaseId,
      parentId: params.navigation.parentId,
      readStartMark,
      retained: new Map(),
      movedOut: new Set(),
    };
    pendingPageReads.add(pendingRead);
  }
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
    if ("available" in response) {
      clearCachedFilesPages(
        queryClient,
        params.databaseId,
        filesNavigationQueryKey(params),
        readStartMark,
        response,
      );
      return response;
    }
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
    return withCreatedFilesRows(
      queryClient,
      params,
      page,
      readStartMark,
      pendingRead,
    );
  } catch (error) {
    // The server checks access to the whole Files database for every page of
    // it, and answers a folder it can't show with a 400. So a refused read of
    // any page means the database is out of reach, and every page of it this
    // tab cached goes too: the top level, the folder pages the sidebar drew,
    // and one a breadcrumb menu reads alone.
    const status = (error as { status?: unknown } | undefined)?.status;
    if (
      !signal?.aborted &&
      (status === 401 || status === 403 || status === 404)
    ) {
      clearCachedFilesPages(
        queryClient,
        params.databaseId,
        filesNavigationQueryKey(params),
        readStartMark,
        undefined,
        error,
      );
    }
    throw error;
  } finally {
    if (expansionKey && pending) pending.delete(expansionKey);
    if (pendingRead) pendingPageReads?.delete(pendingRead);
  }
}

function clearCachedFilesPages(
  queryClient: QueryClient,
  databaseId: string,
  refusedKey: QueryKey,
  readStartMark: number,
  unavailable?: ContentDatabaseUnavailableResponse,
  error?: unknown,
) {
  const cache = queryClient.getQueryCache();
  const refused = cache.find({ queryKey: refusedKey, exact: true });
  for (const query of cache.findAll({
    queryKey: ["action", "query-content-database-items"],
  })) {
    const params = query.queryKey[2] as FilesNavigationPageParams | undefined;
    if (!params?.navigation || params.databaseId !== databaseId) continue;
    if ((filesReadMarks.get(query) ?? 0) > readStartMark) continue;
    // A read still under way would put back what this clears once it
    // answers, so it stops first. The refused read is the one ending here.
    if (query !== refused && query.state.fetchStatus !== "idle") {
      void query.cancel({ revert: true });
    }
    if (params.navigation.pagesOnly) {
      query.setState({
        data: unavailable,
        dataUpdatedAt: unavailable ? Date.now() : 0,
        ...(error === undefined
          ? {}
          : {
              status: "error" as const,
              error:
                error instanceof Error
                  ? error
                  : Object.assign(
                      new Error("Files navigation read was refused"),
                      {
                        cause: error,
                      },
                    ),
            }),
      });
    } else {
      query.setState({ data: undefined, dataUpdatedAt: 0 });
    }
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
  {
    enabled = true,
    refetchOnMount,
  }: { enabled?: boolean; refetchOnMount?: "always" } = {},
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
    ...(refetchOnMount === undefined ? {} : { refetchOnMount }),
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
