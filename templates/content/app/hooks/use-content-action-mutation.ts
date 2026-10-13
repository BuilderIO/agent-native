import { useActionMutation } from "@agent-native/core/client/hooks";
import type { ContentDatabaseNavigationPageResponse } from "@shared/api";
import {
  matchQuery,
  useQueryClient,
  type Query,
  type QueryClient,
  type QueryFilters,
  type QueryKey,
} from "@tanstack/react-query";

const navigationQueryKey = ["action", "query-content-database-items"] as const;

type ActionMutationOptions<TData, TVariables> = NonNullable<
  Parameters<typeof useActionMutation<TData, TVariables>>[1]
>;
type ActionMutationSuccessArgs<TData, TVariables> = Parameters<
  NonNullable<ActionMutationOptions<TData, TVariables>["onSuccess"]>
>;

export type ContentQueryTarget = QueryKey | QueryFilters;

export type ContentMutationInvalidation<TData, TVariables> =
  | readonly ContentQueryTarget[]
  | ((
      data: ActionMutationSuccessArgs<TData, TVariables>[0],
      variables: ActionMutationSuccessArgs<TData, TVariables>[1],
    ) => readonly ContentQueryTarget[]);

/**
 * One invalidation for all targets: a second invalidation of a query that is
 * already refetching cancels that request and starts it again.
 */
export function invalidateContentQueries(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  targets: readonly ContentQueryTarget[],
) {
  if (targets.length === 0) return;
  const filters = targets.map((target) =>
    Array.isArray(target)
      ? { queryKey: target as QueryKey }
      : (target as QueryFilters),
  );
  void queryClient.invalidateQueries({
    predicate: (query) => filters.some((filter) => matchQuery(filter, query)),
  });
}

/**
 * `useActionMutation` without the framework's refetch of every mounted action
 * query. Content mounts workspace-sized reads (the sidebar tree, the Files
 * collection, Trash), so each write names the queries it changes in
 * `invalidates`. Same-tab sync events are ignored, so a query the write
 * changes but does not name stays stale in this tab.
 */
export function useContentActionMutation<
  TData = undefined,
  TVariables = undefined,
>(
  actionName: Parameters<typeof useActionMutation<TData, TVariables>>[0],
  {
    invalidates,
    onSuccess,
    ...options
  }: Omit<
    ActionMutationOptions<TData, TVariables>,
    "skipActionQueryInvalidation"
  > & {
    invalidates: ContentMutationInvalidation<TData, TVariables>;
  },
) {
  const queryClient = useQueryClient();
  return useActionMutation<TData, TVariables>(actionName, {
    ...options,
    skipActionQueryInvalidation: true,
    onSuccess: (...args: ActionMutationSuccessArgs<TData, TVariables>) => {
      const result = onSuccess?.(...args);
      invalidateContentQueries(
        queryClient,
        typeof invalidates === "function"
          ? invalidates(args[0], args[1])
          : invalidates,
      );
      return result;
    },
  });
}

function queryParams(query: Pick<Query, "queryKey">) {
  const params = query.queryKey[2];
  return params && typeof params === "object"
    ? (params as Record<string, unknown>)
    : undefined;
}

/** Every action read about one document: body, comments, properties, history, and review. */
export function documentScopedQueryFilter(documentId: string): QueryFilters {
  return {
    queryKey: ["action"],
    predicate: (query) => {
      const params = queryParams(query);
      return (
        params?.id === documentId ||
        params?.documentId === documentId ||
        (params?.resourceType === "document" &&
          params.resourceId === documentId)
      );
    },
  };
}

type NavigationBranch = { databaseId: unknown; parentId: unknown };

function navigationBranch(
  query: Pick<Query, "queryKey">,
): NavigationBranch | null {
  const params = queryParams(query);
  const navigation = params?.navigation as { parentId?: unknown } | undefined;
  if (!navigation) return null;
  return {
    databaseId: params?.databaseId,
    parentId: navigation.parentId ?? null,
  };
}

function navigationBranchListsAny(
  query: Pick<Query, "state">,
  documentIds: ReadonlySet<string>,
) {
  const data = query.state.data as
    | ContentDatabaseNavigationPageResponse
    | undefined;
  return data?.items?.some((item) => documentIds.has(item.documentId)) === true;
}

/** The cached sidebar branches (parent and collection) that list any of `documentIds`. */
function branchesListing(
  queryClient: Pick<QueryClient, "getQueryCache">,
  documentIds: readonly string[],
): NavigationBranch[] {
  const ids = new Set(documentIds);
  const branches: NavigationBranch[] = [];
  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: navigationQueryKey })) {
    const branch = navigationBranch(query);
    if (branch && navigationBranchListsAny(query, ids)) branches.push(branch);
  }
  return branches;
}

/**
 * Sidebar Files branches (`query-content-database-items` with `navigation`):
 * those listing any of `documentIds`, every loaded page of `branches`, and
 * those listing the children of any of `parentIds`. A root parent (`null`)
 * is limited to `databaseId` when known.
 */
export function contentNavigationBranchFilter({
  documentIds = [],
  parentIds = [],
  databaseId,
  branches = [],
}: {
  documentIds?: readonly string[];
  parentIds?: readonly (string | null)[];
  databaseId?: string | null;
  branches?: readonly NavigationBranch[];
}): QueryFilters {
  const listed = new Set(documentIds);
  const parents = new Set(parentIds);
  return {
    queryKey: navigationQueryKey,
    predicate: (query) => {
      const branch = navigationBranch(query);
      if (!branch) return false;
      if (
        parents.has(branch.parentId as string | null) &&
        (branch.parentId !== null ||
          !databaseId ||
          branch.databaseId === databaseId)
      ) {
        return true;
      }
      if (
        branches.some(
          (candidate) =>
            candidate.parentId === branch.parentId &&
            candidate.databaseId === branch.databaseId,
        )
      ) {
        return true;
      }
      return listed.size > 0 && navigationBranchListsAny(query, listed);
    },
  };
}

/** Navigation contexts (breadcrumb paths) that include any of `documentIds`. */
export function contentNavigationContextFilter(
  documentIds: readonly string[],
): QueryFilters {
  const ids = new Set(documentIds);
  return {
    queryKey: ["action", "get-content-navigation-context"],
    predicate: (query) => {
      const params = queryParams(query);
      if (typeof params?.id === "string" && ids.has(params.id)) return true;
      const data = query.state.data as
        | { document?: { id?: string }; path?: Array<{ id?: string }> }
        | undefined;
      return (
        (typeof data?.document?.id === "string" && ids.has(data.document.id)) ||
        data?.path?.some((entry) => !!entry.id && ids.has(entry.id)) === true
      );
    },
  };
}

/**
 * Reads of a space's Files collection as a collection: the local-files tree,
 * the Files page and its table views. Their Parent column follows every page's
 * placement, which the sidebar's paged branches do not cover.
 */
export function contentFilesCollectionFilter(): QueryFilters {
  return {
    queryKey: ["action"],
    predicate: (query) =>
      (query.queryKey[1] === "get-content-database" ||
        query.queryKey[1] === "query-content-database-items") &&
      !navigationBranch(query) &&
      query.meta?.contentDatabaseSystemRole === "files",
  };
}

/** The Files collection behind a space's root branch, from the cached space list. */
export function contentSpaceFilesDatabaseId(
  queryClient: Pick<QueryClient, "getQueriesData">,
  spaceId: string | null | undefined,
) {
  if (!spaceId) return undefined;
  for (const [, data] of queryClient.getQueriesData<{
    spaces?: Array<{ id: string; filesDatabaseId: string }>;
  }>({ queryKey: ["action", "list-content-spaces"] })) {
    const space = data?.spaces?.find((candidate) => candidate.id === spaceId);
    if (space) return space.filesDatabaseId;
  }
  return undefined;
}

/**
 * Targets for a write that changes pages where they stand (a rename, or a copy
 * placed beside them): every loaded page of the branches that list them, since
 * a sorted branch can move a row to another page, and any path through them.
 */
export function contentRowTargets(
  queryClient: Pick<QueryClient, "getQueryCache">,
  documentIds: readonly string[],
): ContentQueryTarget[] {
  return [
    contentNavigationBranchFilter({
      documentIds,
      branches: branchesListing(queryClient, documentIds),
    }),
    contentNavigationContextFilter(documentIds),
  ];
}

/**
 * Targets for a write that adds, removes, or reparents pages: every loaded
 * page of the branches that list them now, the children of each destination
 * parent, the rows of the old and new parents (their expand control follows
 * `hasChildren`), and any breadcrumb path through the pages. Call it before the
 * write's own cache updates take the pages out of their current branches.
 */
export function contentPlacementTargets(
  queryClient: Pick<QueryClient, "getQueryCache">,
  {
    documentIds,
    parentIds = [],
    databaseId,
  }: {
    documentIds: readonly string[];
    parentIds?: readonly (string | null)[];
    databaseId?: string | null;
  },
): ContentQueryTarget[] {
  const current = branchesListing(queryClient, documentIds);
  const currentDatabaseId = current.find(
    (branch) => typeof branch.databaseId === "string",
  )?.databaseId as string | undefined;
  return [
    contentNavigationBranchFilter({
      documentIds: [
        ...documentIds,
        ...current.flatMap((branch) =>
          typeof branch.parentId === "string" ? [branch.parentId] : [],
        ),
        ...parentIds.filter((id): id is string => id !== null),
      ],
      parentIds,
      databaseId: databaseId ?? currentDatabaseId,
      branches: current,
    }),
    contentNavigationContextFilter(documentIds),
  ];
}
