import { callAction } from "@agent-native/core/client/hooks";
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

export const FILES_NAVIGATION_PAGE_SIZE = 20;

// Most expanded folders one read asks for; the server caps what it returns.
const MAX_EXPANDED_IDS_PER_READ = 100;

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
 * Reads one Files page. The first read of a page also asks for the first
 * pages of `expanded` folders under it, and caches each one the server
 * returns under that folder's own key, so open folders draw with the tree
 * instead of one level per round trip. Later reads of the page leave its
 * children to refresh themselves.
 */
export async function readFilesNavigationPage(
  queryClient: QueryClient,
  params: FilesNavigationPageParams,
  expanded: Iterable<string>,
  signal?: AbortSignal,
): Promise<FilesNavigationRead> {
  const firstRead =
    queryClient.getQueryData(filesNavigationQueryKey(params)) === undefined;
  const expand = firstRead
    ? [...expanded].slice(0, MAX_EXPANDED_IDS_PER_READ)
    : [];
  const response = await callAction<FilesNavigationRead>(
    "query-content-database-items",
    expand.length
      ? { ...params, navigation: { ...params.navigation, expand } }
      : params,
    { method: "GET", signal },
  );
  if ("available" in response) return response;
  const { branches, ...page } = response;
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
}

function retryFilesNavigationRead(failureCount: number, error: unknown) {
  // A 4xx answer (an expired cursor, an unavailable parent) is the same on a
  // second try; the branch reloads or offers Retry instead.
  const status = (error as { status?: unknown } | null)?.status;
  const refused =
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429;
  return !refused && failureCount < 1;
}

export function useFilesNavigationPage(
  params: FilesNavigationPageParams,
  expanded: ReadonlySet<string>,
) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: filesNavigationQueryKey(params),
    queryFn: ({ signal }) =>
      readFilesNavigationPage(queryClient, params, expanded, signal),
    retry: retryFilesNavigationRead,
  });
}
