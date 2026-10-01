import { callAction } from "@agent-native/core/client/hooks";
import type { ContentDatabaseNavigationSort } from "@shared/api";
import type { QueryClient } from "@tanstack/react-query";

import { filesNavigationPageParams } from "@/lib/files-navigation";

// The Files tree's root page is keyed by the space's Files database and the
// personal view's order, which arrive from two other reads. The inputs this
// browser last used for the same person in the same active organization let
// the root page start alongside those reads; when they turn out different,
// the tree reads again with the confirmed ones and the early read is unused.
const FILES_ROOT_HINT_STORAGE_KEY = "content-sidebar-files-root-v1";

export function filesRootHintScope(
  email: string | null | undefined,
  orgId: string | null | undefined,
) {
  const account = email?.trim().toLowerCase();
  return account ? JSON.stringify([account, orgId ?? null]) : null;
}

export type PagedFilesRoot = {
  databaseId: string;
  sort: ContentDatabaseNavigationSort;
  viewId?: string;
};

export function readPagedFilesRootHint(scope: string): PagedFilesRoot | null {
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
      scope?: unknown;
    };
    if (
      hint.scope !== scope ||
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

export function rememberPagedFilesRoot(scope: string, root: PagedFilesRoot) {
  try {
    localStorage.setItem(
      FILES_ROOT_HINT_STORAGE_KEY,
      JSON.stringify({ scope, ...root }),
    );
  } catch {
    // coercion-ok: without storage the next load simply waits for its inputs.
  }
}

export function prefetchPagedFilesRoot(
  queryClient: QueryClient,
  root: PagedFilesRoot,
) {
  const args = filesNavigationPageParams({ ...root, parentId: null });
  void queryClient.prefetchQuery({
    queryKey: ["action", "query-content-database-items", args],
    queryFn: ({ signal }) =>
      callAction("query-content-database-items", args, {
        method: "GET",
        signal,
      }),
  });
}
