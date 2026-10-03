import type { QueryClient } from "@tanstack/react-query";

import {
  filesNavigationPageParams,
  filesNavigationQueryKey,
  readFilesNavigationPage,
} from "@/lib/files-navigation";

// The Files tree's root page is keyed by the space's Files database, which
// arrives from another read. The database this browser last used for the same
// person in the same active organization lets the root page start alongside
// that read; when it turns out different, the tree reads again with the
// confirmed one and the early read is unused.
const FILES_ROOT_HINT_STORAGE_KEY = "content-sidebar-files-root-v1";

export function filesRootHintScope(
  email: string | null | undefined,
  orgId: string | null | undefined,
) {
  const account = email?.trim().toLowerCase();
  return account ? JSON.stringify([account, orgId ?? null]) : null;
}

export type PagedFilesRoot = { databaseId: string };

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
    const hint = JSON.parse(raw) as { scope?: unknown; databaseId?: unknown };
    if (hint.scope !== scope || typeof hint.databaseId !== "string") {
      return null;
    }
    return { databaseId: hint.databaseId };
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

/** Starts the root page, with the first pages of `expanded` folders. */
export function prefetchPagedFilesRoot(
  queryClient: QueryClient,
  root: PagedFilesRoot,
  expanded: readonly string[] = [],
) {
  const params = filesNavigationPageParams({ ...root, parentId: null });
  void queryClient.prefetchQuery({
    queryKey: filesNavigationQueryKey(params),
    queryFn: ({ signal }) =>
      readFilesNavigationPage(queryClient, params, expanded, signal),
  });
}
