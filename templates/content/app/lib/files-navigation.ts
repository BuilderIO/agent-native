import { callActionWithRetry } from "@agent-native/core/client/hooks";
import type {
  ContentDatabaseNavigationPageResponse,
  ContentDatabasePersonalViewOverrides,
  ContentDatabaseUnavailableResponse,
  ContentSidebarViewOrder,
} from "@shared/api";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";

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
// tree and breadcrumb menus share one cached request per page. The server
// orders a branch by the person's saved view, so the order is not part of
// the key: a branch can be read before that view arrives.
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
  try {
    const response = await callActionWithRetry<FilesNavigationRead>(
      "query-content-database-items",
      expand.length
        ? { ...params, navigation: { ...params.navigation, expand } }
        : params,
      { method: "GET", signal },
    );
    if ("available" in response) return response;
    // A folder left out of `branches`, whether the cap dropped it
    // (`branchesTruncated`) or it has no children to show, is not seeded as
    // empty: it reads its own page when it draws.
    const { branches, branchesTruncated, ...page } = response;
    for (const [parentId, branch] of Object.entries(branches ?? {})) {
      const key = filesNavigationQueryKey(
        filesNavigationPageParams({
          databaseId: params.databaseId,
          parentId,
        }),
      );
      // A folder that already has its own page keeps it; that read is the
      // one its later changes refresh.
      if (queryClient.getQueryData(key) === undefined) {
        queryClient.setQueryData(key, branch);
      }
    }
    return page;
  } finally {
    if (expansionKey && pending) pending.delete(expansionKey);
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

export function useFilesNavigationPage(
  params: FilesNavigationPageParams,
  expanded: ReadonlySet<string>,
) {
  const queryClient = useQueryClient();
  const expansionKey = JSON.stringify([
    params.databaseId,
    params.navigation.parentId,
    params.navigation.cursor ?? null,
    [...expanded],
  ]);
  const rootReadExpansion = useRef<string | null>(null);
  const query = useQuery({
    queryKey: filesNavigationQueryKey(params),
    queryFn: ({ signal }) => {
      rootReadExpansion.current = expansionKey;
      return readFilesNavigationPage(queryClient, params, expanded, signal);
    },
    retry: false,
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
