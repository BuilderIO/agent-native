import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import type {
  InboxThreadItem,
  ListInboxThreadsInput,
  ListInboxThreadsResult,
} from "@shared/inbox-threads";
import {
  keepPreviousData,
  useQueries,
  useQueryClient,
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
  const qc = useQueryClient();
  return useActionQuery<ListInboxThreadsResult>("list-inbox-threads", input, {
    enabled: opts?.enabled,
    // The 3s/20s poll below already keeps this fresh — an extra unbounded
    // window-focus refetch fans out across every mounted instance (bar +
    // list) and isn't worth the added request-storm risk.
    refetchInterval: (query) =>
      query.state.data?.syncing ? SYNCING_POLL_MS : IDLE_POLL_MS,
    // Tab switches must never blank the list while the new tab's page loads.
    placeholderData: keepPreviousData,
    select: (data) => applyInboxMutationOverlay(qc, data),
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
  const qc = useQueryClient();
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
        select: (data: ListInboxThreadsResult) =>
          applyInboxMutationOverlay(qc, data),
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

/** Resolve a message id to the thread key used by the action-backed inbox. */
export function findInboxThreadIdByMessageId(
  qc: QueryClient,
  messageId: string,
): string | undefined {
  const item = snapshotInboxThreads(qc)
    .flatMap(([, data]) => data?.items ?? [])
    .find(
      (candidate) =>
        candidate.id === messageId || candidate.messageIds?.includes(messageId),
    );
  return item ? threadKeyOf(item) : undefined;
}

/** Restore a raw inbox snapshot for an explicit cache reset. Optimistic
 * mutation rollbacks retire journal entries instead of replacing this base. */
export function restoreInboxThreadsOptimistic(
  qc: QueryClient,
  snapshot: ReturnType<typeof snapshotInboxThreads>,
) {
  for (const [key, data] of snapshot) qc.setQueryData(key, data);
}

/** Notify inbox observers after the journal changes without changing the raw
 * server snapshot underneath them. The select overlay is the optimistic
 * projection; keeping the base intact makes overlapping rollbacks additive. */
function notifyInboxQueries(qc: QueryClient) {
  qc.setQueriesData<ListInboxThreadsResult>(
    { queryKey: INBOX_THREADS_QUERY_KEY },
    (old) =>
      old
        ? {
            ...old,
            items: old.items.map((item) => ({ ...item })),
            tabs: old.tabs.map((tab) => ({ ...tab })),
          }
        : old,
  );
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

const INBOX_MUTATION_TTL_MS = 60_000;

type InboxThreadState = {
  threadId: string;
  unreadCount: number;
  isRead: boolean;
};

type InboxMutation =
  | {
      id: string;
      kind: "remove";
      observedThreadIds: string[];
      threadIds: string[];
      timestamp: number;
    }
  | {
      id: string;
      kind: "read";
      states: InboxThreadState[];
      timestamp: number;
    }
  | {
      id: string;
      kind: "unread-count";
      state: InboxThreadState;
      timestamp: number;
    }
  | {
      id: string;
      isStarred: boolean;
      kind: "star";
      threadIds: string[];
      timestamp: number;
    };

type InboxRemovalMutation = Extract<InboxMutation, { kind: "remove" }>;
export type InboxThreadRemovalSnapshot = Array<{
  id: string;
  mutation: InboxRemovalMutation;
  threadId: string;
}>;

type InboxMutationInput =
  | Omit<Extract<InboxMutation, { kind: "remove" }>, "id" | "timestamp">
  | Omit<Extract<InboxMutation, { kind: "read" }>, "id" | "timestamp">
  | Omit<Extract<InboxMutation, { kind: "unread-count" }>, "id" | "timestamp">
  | Omit<Extract<InboxMutation, { kind: "star" }>, "id" | "timestamp">;

const inboxMutationJournals = new WeakMap<
  QueryClient,
  Map<string, InboxMutation>
>();
let nextInboxMutationId = 0;

function inboxMutationJournal(qc: QueryClient) {
  let journal = inboxMutationJournals.get(qc);
  if (!journal) {
    journal = new Map();
    inboxMutationJournals.set(qc, journal);
  }
  return journal;
}

function activeInboxMutations(qc: QueryClient): InboxMutation[] {
  const journal = inboxMutationJournal(qc);
  const now = Date.now();
  for (const [id, mutation] of journal) {
    // ponytail: the 60s TTL is the fallback ceiling. Evidence-based retirement
    // below is deliberately conservative because a stale Gmail refetch must
    // never be allowed to resurrect a mutation that has not been observed.
    if (now - mutation.timestamp > INBOX_MUTATION_TTL_MS) journal.delete(id);
  }
  return [...journal.values()];
}

function inboxMutationConflictKeys(mutation: InboxMutation): string[] {
  if (mutation.kind === "read") {
    return mutation.states.map((state) => `state:${state.threadId}`);
  }
  if (mutation.kind === "unread-count") {
    return [`state:${mutation.state.threadId}`];
  }
  if (mutation.kind === "star") {
    return mutation.threadIds.map((threadId) => `star:${threadId}`);
  }
  return [];
}

function currentInboxMutation(
  mutation: InboxMutation,
  latestByKey: ReadonlyMap<string, string>,
): InboxMutation | undefined {
  if (mutation.kind === "read") {
    const states = mutation.states.filter(
      (state) => latestByKey.get(`state:${state.threadId}`) === mutation.id,
    );
    return states.length > 0 ? { ...mutation, states } : undefined;
  }
  if (mutation.kind === "unread-count") {
    return latestByKey.get(`state:${mutation.state.threadId}`) === mutation.id
      ? mutation
      : undefined;
  }
  if (mutation.kind === "star") {
    const threadIds = mutation.threadIds.filter(
      (threadId) => latestByKey.get(`star:${threadId}`) === mutation.id,
    );
    return threadIds.length > 0 ? { ...mutation, threadIds } : undefined;
  }
  return mutation;
}

function inboxMutationSequence(id: string): number {
  return Number(id.slice("inbox-mutation-".length)) || 0;
}

function supersedeOlderInboxMutations(qc: QueryClient, settled: InboxMutation) {
  const settledKeys = new Set(inboxMutationConflictKeys(settled));
  if (settledKeys.size === 0) return;
  const settledSequence = inboxMutationSequence(settled.id);
  const journal = inboxMutationJournal(qc);

  for (const [id, mutation] of journal) {
    if (
      id === settled.id ||
      inboxMutationSequence(id) >= settledSequence ||
      mutation.kind === "remove"
    ) {
      continue;
    }
    if (mutation.kind === "read") {
      const states = mutation.states.filter(
        (state) => !settledKeys.has(`state:${state.threadId}`),
      );
      if (states.length === 0) journal.delete(id);
      else journal.set(id, { ...mutation, states });
    } else if (mutation.kind === "unread-count") {
      if (settledKeys.has(`state:${mutation.state.threadId}`)) {
        journal.delete(id);
      }
    } else if (mutation.kind === "star") {
      const threadIds = mutation.threadIds.filter(
        (threadId) => !settledKeys.has(`star:${threadId}`),
      );
      if (threadIds.length === 0) journal.delete(id);
      else journal.set(id, { ...mutation, threadIds });
    }
  }
}

function applyInboxMutationToItem(
  item: InboxThreadItem,
  mutation: InboxMutation,
): InboxThreadItem | undefined {
  const threadId = threadKeyOf(item);
  if (mutation.kind === "remove") {
    return mutation.threadIds.includes(threadId) ? undefined : item;
  }
  if (mutation.kind === "star") {
    return mutation.threadIds.includes(threadId)
      ? { ...item, isStarred: mutation.isStarred }
      : item;
  }
  const state =
    mutation.kind === "read"
      ? mutation.states.find((value) => value.threadId === threadId)
      : mutation.state.threadId === threadId
        ? mutation.state
        : undefined;
  return state
    ? { ...item, isRead: state.isRead, unreadCount: state.unreadCount }
    : item;
}

function currentInboxItem(
  qc: QueryClient,
  threadId: string,
): InboxThreadItem | undefined {
  let item = snapshotInboxThreads(qc)
    .flatMap(([, data]) => data?.items ?? [])
    .find((candidate) => threadKeyOf(candidate) === threadId);
  for (const mutation of activeInboxMutations(qc)) {
    if (item) item = applyInboxMutationToItem(item, mutation);
    if (!item) return undefined;
  }
  return item;
}

function recordInboxMutation(
  qc: QueryClient,
  mutation: InboxMutationInput,
): InboxMutation {
  const id = `inbox-mutation-${++nextInboxMutationId}`;
  const recorded = {
    ...mutation,
    id,
    timestamp: Date.now(),
  } as InboxMutation;
  inboxMutationJournal(qc).set(id, recorded);
  return recorded;
}

export function forgetInboxMutation(qc: QueryClient, id: string) {
  if (inboxMutationJournal(qc).delete(id)) notifyInboxQueries(qc);
}

/** Keep only the targets that a partially completed bulk mutation changed. */
export function retainInboxMutationTargets(
  qc: QueryClient,
  id: string,
  threadIds: ReadonlySet<string>,
): string | undefined {
  const journal = inboxMutationJournal(qc);
  const mutation = journal.get(id);
  if (!mutation) return undefined;

  if (mutation.kind === "remove") {
    const keptThreadIds = mutation.threadIds.filter((threadId) =>
      threadIds.has(threadId),
    );
    const keptObservedThreadIds = mutation.observedThreadIds.filter(
      (threadId) => threadIds.has(threadId),
    );
    if (keptThreadIds.length === 0) journal.delete(id);
    else
      journal.set(id, {
        ...mutation,
        observedThreadIds: keptObservedThreadIds,
        threadIds: keptThreadIds,
      });
  } else if (mutation.kind === "read") {
    const states = mutation.states.filter((state) =>
      threadIds.has(state.threadId),
    );
    if (states.length === 0) journal.delete(id);
    else journal.set(id, { ...mutation, states });
  } else if (mutation.kind === "unread-count") {
    if (!threadIds.has(mutation.state.threadId)) journal.delete(id);
  } else {
    const keptThreadIds = mutation.threadIds.filter((threadId) =>
      threadIds.has(threadId),
    );
    if (keptThreadIds.length === 0) journal.delete(id);
    else journal.set(id, { ...mutation, threadIds: keptThreadIds });
  }

  notifyInboxQueries(qc);
  return journal.has(id) ? id : undefined;
}

/** Retire a journal entry only after a refetch contains the requested state. */
export function settleInboxMutationIfObserved(
  qc: QueryClient,
  id: string | undefined,
) {
  if (!id) return;
  const mutation = inboxMutationJournal(qc).get(id);
  if (!mutation) return;
  const items = snapshotInboxThreads(qc).flatMap(
    ([, data]) => data?.items ?? [],
  );
  const itemByThread = new Map(
    items.map((item) => [threadKeyOf(item), item] as const),
  );

  if (mutation.kind === "remove") {
    if (
      mutation.observedThreadIds.length !== mutation.threadIds.length ||
      mutation.observedThreadIds.some((threadId) => itemByThread.has(threadId))
    ) {
      return;
    }
  } else if (mutation.kind === "star") {
    if (
      !mutation.threadIds.every((threadId) => {
        const item = itemByThread.get(threadId);
        return item !== undefined && item.isStarred === mutation.isStarred;
      })
    ) {
      return;
    }
  } else {
    const states =
      mutation.kind === "read" ? mutation.states : [mutation.state];
    if (
      !states.every((state) => {
        const item = itemByThread.get(state.threadId);
        return (
          item !== undefined &&
          item.isRead === state.isRead &&
          item.unreadCount === state.unreadCount
        );
      })
    ) {
      return;
    }
  }

  supersedeOlderInboxMutations(qc, mutation);
  forgetInboxMutation(qc, id);
}

/** Drop only the optimistic removals for one thread, used by archive undo. */
export function clearInboxThreadRemoval(
  qc: QueryClient,
  threadId: string,
): InboxThreadRemovalSnapshot {
  const journal = inboxMutationJournal(qc);
  const snapshot: InboxThreadRemovalSnapshot = [];
  for (const [id, mutation] of journal) {
    if (mutation.kind !== "remove" || !mutation.threadIds.includes(threadId)) {
      continue;
    }
    snapshot.push({ id, mutation, threadId });
    const threadIds = mutation.threadIds.filter((value) => value !== threadId);
    if (threadIds.length === 0) journal.delete(id);
    else
      journal.set(id, {
        ...mutation,
        observedThreadIds: mutation.observedThreadIds.filter(
          (value) => value !== threadId,
        ),
        threadIds,
      });
  }
  if (snapshot.length > 0) notifyInboxQueries(qc);
  return snapshot;
}

export function restoreInboxThreadRemovals(
  qc: QueryClient,
  snapshot: InboxThreadRemovalSnapshot,
) {
  const journal = inboxMutationJournal(qc);
  for (const { id, mutation, threadId } of snapshot) {
    const current = journal.get(id);
    if (current?.kind === "remove") {
      if (!current.threadIds.includes(threadId)) {
        journal.set(id, {
          ...current,
          threadIds: [...current.threadIds, threadId],
          observedThreadIds: current.observedThreadIds.includes(threadId)
            ? current.observedThreadIds
            : mutation.observedThreadIds.includes(threadId)
              ? [...current.observedThreadIds, threadId]
              : current.observedThreadIds,
        });
      }
      continue;
    }
    journal.set(id, {
      ...mutation,
      threadIds: [threadId],
      observedThreadIds: mutation.observedThreadIds.includes(threadId)
        ? [threadId]
        : [],
    });
  }
  if (snapshot.length > 0) notifyInboxQueries(qc);
}

export async function cancelInboxThreadsQueries(qc: QueryClient) {
  await qc.cancelQueries({ queryKey: INBOX_THREADS_QUERY_KEY });
}

function unreadTabDelta(previous: number, next: number): number {
  if (previous === 0 && next > 0) return 1;
  if (previous > 0 && next === 0) return -1;
  return 0;
}

function updateActiveTabUnread(
  tabs: ListInboxThreadsResult["tabs"],
  activeTabId: string,
  delta: number,
) {
  if (delta === 0) return tabs;
  return tabs.map((tab) =>
    tab.id === activeTabId
      ? { ...tab, unread: Math.max(0, tab.unread + delta) }
      : tab,
  );
}

function applyInboxMutation(
  data: ListInboxThreadsResult,
  mutation: InboxMutation,
): ListInboxThreadsResult {
  if (mutation.kind === "remove") {
    const removed = data.items.filter((item) =>
      mutation.threadIds.includes(threadKeyOf(item)),
    );
    if (removed.length === 0) return data;
    return {
      ...data,
      items: data.items.filter(
        (item) => !mutation.threadIds.includes(threadKeyOf(item)),
      ),
      total: Math.max(0, data.total - removed.length),
      tabs: updateActiveTabUnread(
        data.tabs.map((tab) =>
          tab.id === data.activeTabId
            ? {
                ...tab,
                total: Math.max(0, tab.total - removed.length),
              }
            : tab,
        ),
        data.activeTabId,
        -removed.filter((item) => item.unreadCount > 0).length,
      ),
    };
  }

  if (mutation.kind === "star") {
    return {
      ...data,
      items: data.items.map((item) =>
        mutation.threadIds.includes(threadKeyOf(item))
          ? { ...item, isStarred: mutation.isStarred }
          : item,
      ),
    };
  }

  let unreadDelta = 0;
  const items = data.items.map((item) => {
    const next = applyInboxMutationToItem(item, mutation);
    if (!next) return item;
    unreadDelta += unreadTabDelta(item.unreadCount, next.unreadCount);
    return next;
  });

  return {
    ...data,
    items,
    tabs: updateActiveTabUnread(data.tabs, data.activeTabId, unreadDelta),
  };
}

export function applyInboxMutationOverlay(
  qc: QueryClient,
  data: ListInboxThreadsResult,
): ListInboxThreadsResult {
  let result = data;
  const mutations = activeInboxMutations(qc);
  const latestByKey = new Map<string, string>();
  for (const mutation of mutations) {
    for (const key of inboxMutationConflictKeys(mutation)) {
      const current = latestByKey.get(key);
      if (
        !current ||
        inboxMutationSequence(mutation.id) > inboxMutationSequence(current)
      ) {
        latestByKey.set(key, mutation.id);
      }
    }
  }
  // Keep older entries for rollback, but project only the newest intent for
  // each thread field until that newer mutation settles.
  for (const mutation of mutations) {
    const current = currentInboxMutation(mutation, latestByKey);
    if (current) result = applyInboxMutation(result, current);
  }
  return result;
}

/**
 * Optimistically remove threads (archive/trash) from every cached
 * list-inbox-threads page. The journal overlay adjusts the rendered `total`
 * and active-tab count without rewriting the raw server snapshot.
 *
 * ponytail: the overlay still derives each page's count independently, so a
 * page beyond page 0 can report a transient local total until refetch settles.
 * Upgrade path: give the journal per-tab membership so one global removal can
 * adjust every cached page without double-counting stale cross-tab rows.
 */
export function removeInboxThreadsOptimistic(
  qc: QueryClient,
  threadIds: ReadonlySet<string>,
) {
  const cachedThreadIds = new Set(
    snapshotInboxThreads(qc)
      .flatMap(([, data]) => data?.items ?? [])
      .map(threadKeyOf),
  );
  const mutation = recordInboxMutation(qc, {
    kind: "remove",
    observedThreadIds: [...threadIds].filter((threadId) =>
      cachedThreadIds.has(threadId),
    ),
    threadIds: [...threadIds],
  });
  notifyInboxQueries(qc);
  return mutation.id;
}

/** Optimistically patch a thread's read state (mark-read/mark-thread-read)
 * and adjust the active tab's unread count by the resulting delta. */
export function markInboxThreadReadOptimistic(
  qc: QueryClient,
  threadIds: ReadonlySet<string>,
  isRead: boolean,
) {
  const states = [...threadIds].map((threadId) => {
    const item = currentInboxItem(qc, threadId);
    const unreadCount = isRead ? 0 : Math.max(1, item?.unreadCount ?? 0);
    return { threadId, unreadCount, isRead };
  });
  const mutation = recordInboxMutation(qc, {
    kind: "read",
    states,
  });
  notifyInboxQueries(qc);
  return mutation.id;
}

/**
 * Optimistically adjust one thread row's unread count by a single message's
 * read/unread delta (±1), instead of setting the whole row read/unread like
 * `markInboxThreadReadOptimistic` — for message-scoped mutations (mark one
 * message read/unread) where other messages in the thread may still be
 * unread. The journal stores the absolute target so replaying it over an
 * already-updated server response is idempotent. Mirrors the clamp-to-[0,
 * messageCount] rule in server/lib/inbox-store.ts's message scope. The active
 * tab's unread count only moves when the row itself crosses the zero/nonzero
 * boundary — the tab counts unread *threads*, not messages.
 */
export function adjustInboxThreadUnreadOptimistic(
  qc: QueryClient,
  threadId: string,
  delta: 1 | -1,
) {
  const item = currentInboxItem(qc, threadId);
  const unreadCount = Math.max(
    0,
    Math.min(
      Math.max(1, item?.messageCount ?? 1),
      (item?.unreadCount ?? 0) + delta,
    ),
  );
  const mutation = recordInboxMutation(qc, {
    kind: "unread-count",
    state: { threadId, unreadCount, isRead: unreadCount === 0 },
  });
  notifyInboxQueries(qc);
  return mutation.id;
}

/** Optimistically toggle star — no tab count is derived from star state. */
export function toggleInboxThreadsStarOptimistic(
  qc: QueryClient,
  threadIds: ReadonlySet<string>,
  isStarred: boolean,
) {
  const mutation = recordInboxMutation(qc, {
    isStarred,
    kind: "star",
    threadIds: [...threadIds],
  });
  notifyInboxQueries(qc);
  return mutation.id;
}
