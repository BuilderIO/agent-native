import { callAction } from "@agent-native/core/client/hooks";
import type { ContentDatabaseNavigationSort } from "@shared/api";
import type { QueryClient } from "@tanstack/react-query";

// The Files tree's root page is keyed by the space's Files database and the
// personal view's order, which arrive from two other reads. The inputs this
// browser last used for the same account let the root page start alongside
// those reads; when they turn out different, the tree reads again with the
// confirmed ones and the early read is simply unused.
const FILES_ROOT_HINT_STORAGE_KEY = "content-sidebar-files-root-v1";

export type PagedFilesRoot = {
  databaseId: string;
  sort: ContentDatabaseNavigationSort;
  viewId?: string;
};

export function pagedFilesNavigationArgs(args: {
  databaseId: string;
  parentId: string | null;
  sort: ContentDatabaseNavigationSort;
  viewId?: string;
  cursor?: string;
}) {
  return {
    databaseId: args.databaseId,
    limit: 20,
    navigation: {
      parentId: args.parentId,
      sort: args.sort,
      viewId: args.viewId,
      cursor: args.cursor,
    },
  };
}

export function readPagedFilesRootHint(
  accountId: string,
): PagedFilesRoot | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(FILES_ROOT_HINT_STORAGE_KEY);
  } catch {
    // coercion-ok: an unreadable hint only means the tree starts at its usual time.
    return null;
  }
  if (!raw) return null;
  try {
    const hint = JSON.parse(raw) as Partial<PagedFilesRoot> & {
      accountId?: unknown;
    };
    if (
      hint.accountId !== accountId ||
      typeof hint.databaseId !== "string" ||
      typeof hint.sort !== "string"
    ) {
      return null;
    }
    return {
      databaseId: hint.databaseId,
      sort: hint.sort,
      ...(typeof hint.viewId === "string" ? { viewId: hint.viewId } : {}),
    };
  } catch {
    // coercion-ok: a malformed hint is ignored and replaced by the next write.
    return null;
  }
}

export function rememberPagedFilesRoot(
  accountId: string,
  root: PagedFilesRoot,
) {
  try {
    localStorage.setItem(
      FILES_ROOT_HINT_STORAGE_KEY,
      JSON.stringify({ accountId, ...root }),
    );
  } catch {
    // coercion-ok: without storage the next load simply waits for its inputs.
  }
}

export function prefetchPagedFilesRoot(
  queryClient: QueryClient,
  root: PagedFilesRoot,
) {
  const args = pagedFilesNavigationArgs({ ...root, parentId: null });
  void queryClient.prefetchQuery({
    queryKey: ["action", "query-content-database-items", args],
    queryFn: ({ signal }) =>
      callAction("query-content-database-items", args, {
        method: "GET",
        signal,
      }),
  });
}
