import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import type {
  InboxThreadItem,
  ListInboxThreadsInput,
  ListInboxThreadsResult,
} from "@shared/inbox-threads";
import {
  keepPreviousData,
  useQueries,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

/** Action query key prefix — matches every `list-inbox-threads` variant
 * (any tab/account/pagination params), so a single invalidate call reaches
 * every cached page. See useActionQuery's `["action", name, params]` shape. */
export const INBOX_THREADS_QUERY_KEY = ["action", "list-inbox-threads"];

const SYNCING_POLL_MS = 3_000;
const IDLE_POLL_MS = 20_000;

/** Rows per page. Page 0 comes from `useInboxThreads` (polled); pages beyond
 * that come from `useInboxThreadsPages` (fetched on demand, no poll). */
export const INBOX_PAGE_SIZE = 100;

/**
 * The inbox tab bar and list's first page both read through this hook with
 * identical `input`, so React Query dedupes them into one network request —
 * same pattern as `useLabels` being called independently from AppLayout and
 * InboxPage today. Tabs, counts, sync status, accounts, and labels all come
 * from this page-0 response; later pages only ever contribute more `items`.
 */
export function useInboxThreads(
  input: ListInboxThreadsInput,
  opts?: { enabled?: boolean },
) {
  return useActionQuery<ListInboxThreadsResult>("list-inbox-threads", input, {
    enabled: opts?.enabled,
    // The 3s/20s poll below already keeps this fresh — an extra unbounded
    // window-focus refetch fans out across every mounted instance (bar +
    // list) and isn't worth the added request-storm risk.
    refetchInterval: (query) =>
      query.state.data?.syncing ? SYNCING_POLL_MS : IDLE_POLL_MS,
    // Tab switches must never blank the list while the new tab's page loads.
    placeholderData: keepPreviousData,
  });
}

/**
 * "Load more" pages beyond page 0, one query per offset. Deliberately NOT a
 * single `useInfiniteQuery`: refetching an infinite query (on focus, on
 * interval) replays every loaded page's request, which is exactly the
 * request-storm pattern `useEmails` already avoids for the same reason. A
 * `useQueries` array keeps each page an independent, unpolled query that
 * still shares the `["action","list-inbox-threads",...]` key prefix, so
 * `invalidateInboxThreads` and the optimistic helpers below reach it too.
 */
export function useInboxThreadsPages(
  input: Omit<ListInboxThreadsInput, "offset">,
  offsets: readonly number[],
  opts?: { enabled?: boolean },
): UseQueryResult<ListInboxThreadsResult>[] {
  return useQueries({
    queries: offsets.map((offset) => {
      const params: ListInboxThreadsInput = { ...input, offset };
      return {
        queryKey: ["action", "list-inbox-threads", params],
        queryFn: () =>
          callAction<ListInboxThreadsResult>("list-inbox-threads", params, {
            method: "GET",
          }),
        enabled: opts?.enabled ?? true,
        placeholderData: keepPreviousData,
        staleTime: 60_000,
      };
    }),
  });
}

/** Concatenates loaded pages' items in offset order. `undefined` entries
 * (a page not yet fetched) contribute nothing. */
export function mergeInboxThreadPages(
  pages: ReadonlyArray<Pick<ListInboxThreadsResult, "items"> | undefined>,
): InboxThreadItem[] {
  return pages.flatMap((page) => page?.items ?? []);
}

/** More rows exist beyond what's loaded when the loaded count hasn't caught
 * up to the tab's total (read from page 0 — see `useInboxThreads`'s doc). */
export function inboxThreadsHasNextPage(
  loadedCount: number,
  total: number,
): boolean {
  return loadedCount < total;
}

export function invalidateInboxThreads(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: INBOX_THREADS_QUERY_KEY });
}

/** Snapshot every cached `list-inbox-threads` page before an optimistic
 * write, for `restoreInboxThreadsOptimistic` to roll back on mutation error.
 * Take this alongside the existing `['emails']` snapshot — the two caches
 * are restored independently. */
export function snapshotInboxThreads(qc: QueryClient) {
  return qc.getQueriesData<ListInboxThreadsResult>({
    queryKey: INBOX_THREADS_QUERY_KEY,
  });
}

/** Restore a snapshot taken with `snapshotInboxThreads` — used on mutation
 * error rollback, mirroring the `['emails']` `context.previous` restore. */
export function restoreInboxThreadsOptimistic(
  qc: QueryClient,
  snapshot: ReturnType<typeof snapshotInboxThreads>,
) {
  for (const [key, data] of snapshot) qc.setQueryData(key, data);
}

/** Back-compat: old `?label=<id>` / `?filter=<id>` links and the `?tab=other`
 * sentinel all resolve to the same `?tab=<id>` the new contract expects.
 * Undefined means "let the server default to its first configured tab". */
export function resolveInboxTabId(
  searchParams: URLSearchParams,
): string | undefined {
  return (
    searchParams.get("tab") ||
    searchParams.get("label") ||
    searchParams.get("filter") ||
    undefined
  );
}

function threadKeyOf(item: Pick<InboxThreadItem, "id" | "threadId">): string {
  return item.threadId || item.id;
}

/**
 * Optimistically remove threads (archive/trash) from every cached
 * list-inbox-threads page and decrement that page's own `total`/active-tab
 * count — the only tab we can adjust without re-deriving server-side tab
 * membership.
 *
 * ponytail: each cached page decrements its own `total` independently, so a
 * removal from a page beyond page 0 doesn't touch page 0's `total` (the one
 * `hasNextPage` math reads) until the 3s `delayedInvalidate` refetch settles
 * — a load-more page can transiently look available for a few seconds after
 * archiving something from page 2+. Upgrade path: pre-scan every cached page
 * for a global removed count and apply it to every page's `total` uniformly
 * — skipped because a naive version double-counts a thread cached under two
 * different tabs' stale queries; doing it right needs per-tab scoping this
 * helper doesn't have today.
 */
export function removeInboxThreadsOptimistic(
  qc: QueryClient,
  threadIds: ReadonlySet<string>,
) {
  qc.setQueriesData<ListInboxThreadsResult>(
    { queryKey: INBOX_THREADS_QUERY_KEY },
    (old) => {
      if (!old) return old;
      const removed = old.items.filter((item) =>
        threadIds.has(threadKeyOf(item)),
      );
      if (removed.length === 0) return old;
      const unreadRemoved = removed.filter(
        (item) => item.unreadCount > 0,
      ).length;
      return {
        ...old,
        items: old.items.filter((item) => !threadIds.has(threadKeyOf(item))),
        total: Math.max(0, old.total - removed.length),
        tabs: old.tabs.map((tab) =>
          tab.id === old.activeTabId
            ? {
                ...tab,
                total: Math.max(0, tab.total - removed.length),
                unread: Math.max(0, tab.unread - unreadRemoved),
              }
            : tab,
        ),
      };
    },
  );
}

/** Optimistically patch a thread's read state (mark-read/mark-thread-read)
 * and adjust the active tab's unread count by the resulting delta. */
export function markInboxThreadReadOptimistic(
  qc: QueryClient,
  threadIds: ReadonlySet<string>,
  isRead: boolean,
) {
  qc.setQueriesData<ListInboxThreadsResult>(
    { queryKey: INBOX_THREADS_QUERY_KEY },
    (old) => {
      if (!old) return old;
      let unreadDelta = 0;
      const items = old.items.map((item) => {
        if (!threadIds.has(threadKeyOf(item))) return item;
        const nextUnreadCount = isRead ? 0 : Math.max(1, item.unreadCount);
        unreadDelta += nextUnreadCount - item.unreadCount;
        return {
          ...item,
          isRead,
          unreadCount: nextUnreadCount,
        };
      });
      if (unreadDelta === 0) return { ...old, items };
      return {
        ...old,
        items,
        tabs: old.tabs.map((tab) =>
          tab.id === old.activeTabId
            ? { ...tab, unread: Math.max(0, tab.unread + unreadDelta) }
            : tab,
        ),
      };
    },
  );
}

/** Optimistically toggle star — no tab count is derived from star state. */
export function toggleInboxThreadsStarOptimistic(
  qc: QueryClient,
  threadIds: ReadonlySet<string>,
  isStarred: boolean,
) {
  qc.setQueriesData<ListInboxThreadsResult>(
    { queryKey: INBOX_THREADS_QUERY_KEY },
    (old) => {
      if (!old) return old;
      return {
        ...old,
        items: old.items.map((item) =>
          threadIds.has(threadKeyOf(item)) ? { ...item, isStarred } : item,
        ),
      };
    },
  );
}
