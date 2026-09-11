import { useActionQuery } from "@agent-native/core/client/hooks";
import type {
  InboxThreadItem,
  ListInboxThreadsInput,
  ListInboxThreadsResult,
} from "@shared/inbox-threads";
import { keepPreviousData, type QueryClient } from "@tanstack/react-query";

/** Action query key prefix — matches every `list-inbox-threads` variant
 * (any tab/account/pagination params), so a single invalidate call reaches
 * every cached page. See useActionQuery's `["action", name, params]` shape. */
export const INBOX_THREADS_QUERY_KEY = ["action", "list-inbox-threads"];

const SYNCING_POLL_MS = 3_000;
const IDLE_POLL_MS = 20_000;

/**
 * The inbox tab bar and list both read through this hook with identical
 * `input`, so React Query dedupes them into one network request — same
 * pattern as `useLabels` being called independently from AppLayout and
 * InboxPage today.
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

export function invalidateInboxThreads(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: INBOX_THREADS_QUERY_KEY });
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

/** Optimistically remove threads (archive/trash) from every cached
 * list-inbox-threads page and decrement that page's own active tab total —
 * the only tab we can adjust without re-deriving server-side tab membership. */
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
