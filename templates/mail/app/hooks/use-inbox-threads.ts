import { callActionWithRetry } from "@agent-native/core/client/hooks";
import { agentNativeApiDisabledReason } from "@agent-native/core/client/host";
import type {
  InboxThreadItem,
  ListInboxThreadsInput,
  ListInboxThreadsResult,
} from "@shared/inbox-threads";
import {
  keepPreviousData,
  skipToken,
  useQuery,
  useQueries,
  useQueryClient,
  type QueryKey,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

/** Action query key prefix — matches every `list-inbox-threads` variant
 * (any tab/account/pagination params), so a single invalidate call reaches
 * every cached page. See useActionQuery's `["action", name, params]` shape. */
export const INBOX_THREADS_QUERY_KEY = ["action", "list-inbox-threads"];

const SYNCING_POLL_MS = 3_000;
const IDLE_POLL_MS = 20_000;
const INBOX_THREADS_STALE_TIME_MS = IDLE_POLL_MS;

export type InboxOverview = Pick<
  ListInboxThreadsResult,
  "tabs" | "syncing" | "accounts" | "labels"
> & { clientSnapshotId: number };

export function inboxOverviewQueryKey(accountEmails?: readonly string[]) {
  const accounts = accountEmails
    ? [...accountEmails].map((email) => email.toLowerCase()).sort()
    : undefined;
  return ["mail-inbox-overview", accounts] as const;
}

export function publishInboxOverview(
  qc: QueryClient,
  accountEmails: readonly string[] | undefined,
  incoming: InboxOverview,
) {
  const queryKey = inboxOverviewQueryKey(accountEmails);
  const current = qc.getQueryData<InboxOverview>(queryKey);
  if (current && current.clientSnapshotId >= incoming.clientSnapshotId) return;
  qc.setQueryData(queryKey, incoming);
}

/** Shared metadata is populated by the active tab query and never fetches separately. */
export function useInboxOverview(accountEmails?: readonly string[]) {
  return useQuery<InboxOverview>({
    queryKey: inboxOverviewQueryKey(accountEmails),
    queryFn: skipToken,
    staleTime: Infinity,
  });
}

// Not yet re-exported for template use from
// packages/core/src/client/create-query-client.ts's isTerminalAuthFailure.
export function isUnauthorizedError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "status" in error &&
    ((error as { status?: unknown }).status === 401 ||
      (error as { status?: unknown }).status === 403)
  );
}

/** Exported so a spec can pin the poll/stop decision directly, instead of only
 * through `isUnauthorizedError`. A signed-out/expired tab (e.g. an embedded
 * surface with no session) otherwise reissues the identical 401/403 forever. A
 * remount, a mutation invalidation, or an explicit refetch still retries. */
export function inboxThreadsRefetchInterval(query: {
  state: { error: unknown; data?: { syncing?: boolean } };
}): number | false {
  if (isUnauthorizedError(query.state.error)) return false;
  return query.state.data?.syncing ? SYNCING_POLL_MS : IDLE_POLL_MS;
}

/** Rows per page. Page 0 comes from `useInboxThreads` (polled); pages beyond
 * that come from `useInboxThreadsPages` (fetched on demand, no poll). */
export const INBOX_PAGE_SIZE = 100;

type InboxQueryResult = ListInboxThreadsResult & {
  /** Client-only request-start fence for optimistic journal evidence. */
  clientSnapshotId: number;
};

export function keepLatestInboxSnapshot(
  current: InboxQueryResult | undefined,
  incoming: InboxQueryResult,
): InboxQueryResult {
  return current && current.clientSnapshotId > incoming.clientSnapshotId
    ? current
    : incoming;
}

let nextInboxSnapshotId = 0;

function readInboxQueryParams(key: QueryKey): Record<string, unknown> | null {
  const params = key[2];
  return params && typeof params === "object"
    ? (params as Record<string, unknown>)
    : null;
}

function inboxQueryScope(key: QueryKey): string {
  const params = readInboxQueryParams(key);
  if (!params) return JSON.stringify(key);
  return JSON.stringify([key[0], key[1], { ...params, offset: 0 }]);
}

function inboxQueryOffset(key: QueryKey): number {
  const offset = readInboxQueryParams(key)?.offset;
  return typeof offset === "number" && Number.isFinite(offset) ? offset : 0;
}

function freshCompleteInboxScope(
  snapshots: ReadonlyArray<[QueryKey, InboxQueryResult | undefined]>,
  scope: string,
  fence: number,
): boolean {
  const pages = snapshots
    .filter(
      ([key, data]) =>
        inboxQueryScope(key) === scope &&
        data !== undefined &&
        data.clientSnapshotId > fence,
    )
    .sort(([a], [b]) => inboxQueryOffset(a) - inboxQueryOffset(b));
  if (pages.length === 0) return false;
  const firstPage = pages.find(([key]) => inboxQueryOffset(key) === 0)?.[1];
  const total = firstPage?.total;
  if (typeof total !== "number") return false;
  let covered = 0;
  for (const [key, data] of pages) {
    if (!data) return false;
    const offset = inboxQueryOffset(key);
    if (offset > covered) return false;
    covered = Math.max(covered, offset + data.items.length);
  }
  return covered >= total && pages.some(([, data]) => data?.complete === true);
}

function fetchInboxThreads(
  input: ListInboxThreadsInput,
  signal: AbortSignal,
  qc: QueryClient,
  queryKey: QueryKey,
): Promise<InboxQueryResult> {
  const clientSnapshotId = ++nextInboxSnapshotId;
  return callActionWithRetry<ListInboxThreadsResult>(
    "list-inbox-threads",
    input,
    { method: "GET", signal },
  ).then((data) => {
    const incoming = { ...data, clientSnapshotId };
    publishInboxOverview(qc, input.accountEmails, {
      tabs: incoming.tabs,
      syncing: incoming.syncing,
      accounts: incoming.accounts,
      labels: incoming.labels,
      clientSnapshotId,
    });
    const current = qc.getQueryData<InboxQueryResult>(queryKey);
    return keepLatestInboxSnapshot(current, incoming);
  });
}

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
  return useQuery<InboxQueryResult>({
    queryKey: ["action", "list-inbox-threads", input],
    queryFn: ({ signal, queryKey }) =>
      fetchInboxThreads(input, signal, qc, queryKey),
    enabled: (opts?.enabled ?? true) && !agentNativeApiDisabledReason(),
    retry: false,
    // The 3s/20s poll below already keeps this fresh — an extra unbounded
    // window-focus refetch fans out across every mounted instance (bar +
    // list) and isn't worth the added request-storm risk.
    refetchInterval: inboxThreadsRefetchInterval,
    staleTime: INBOX_THREADS_STALE_TIME_MS,
    // Tab switches must never blank the list while the new tab's page loads.
    placeholderData: keepPreviousData,
    select: (data) => applyInboxMutationOverlay(qc, data) as InboxQueryResult,
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
        queryFn: ({
          signal,
          queryKey,
        }: {
          signal: AbortSignal;
          queryKey: QueryKey;
        }) => fetchInboxThreads(params, signal, qc, queryKey),
        enabled: (opts?.enabled ?? true) && !agentNativeApiDisabledReason(),
        retry: false,
        placeholderData: keepPreviousData,
        select: (data: ListInboxThreadsResult) =>
          applyInboxMutationOverlay(qc, data) as InboxQueryResult,
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
      observedQueryScopesByThread: Record<string, string[]>;
      providerSnapshotFence: number;
      threadIds: string[];
    }
  | {
      id: string;
      kind: "read";
      providerSnapshotFence: number;
      states: InboxThreadState[];
    }
  | {
      id: string;
      kind: "unread-count";
      providerSnapshotFence: number;
      state: InboxThreadState;
    }
  | {
      id: string;
      isStarred: boolean;
      kind: "star";
      providerSnapshotFence: number;
      threadIds: string[];
    };

type InboxRemovalMutation = Extract<InboxMutation, { kind: "remove" }>;
export type InboxThreadRemovalSnapshot = Array<{
  id: string;
  mutation: InboxRemovalMutation;
  threadId: string;
}>;

type InboxMutationInput =
  | Omit<
      Extract<InboxMutation, { kind: "remove" }>,
      "id" | "providerSnapshotFence"
    >
  | Omit<
      Extract<InboxMutation, { kind: "read" }>,
      "id" | "providerSnapshotFence"
    >
  | Omit<
      Extract<InboxMutation, { kind: "unread-count" }>,
      "id" | "providerSnapshotFence"
    >
  | Omit<
      Extract<InboxMutation, { kind: "star" }>,
      "id" | "providerSnapshotFence"
    >;

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
  return [...inboxMutationJournal(qc).values()];
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
    providerSnapshotFence: nextInboxSnapshotId,
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
    const observedQueryScopesByThread = Object.fromEntries(
      Object.entries(mutation.observedQueryScopesByThread).filter(
        ([threadId]) => threadIds.has(threadId),
      ),
    );
    if (keptThreadIds.length === 0) journal.delete(id);
    else
      journal.set(id, {
        ...mutation,
        observedThreadIds: keptObservedThreadIds,
        observedQueryScopesByThread,
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
  const snapshots = snapshotInboxThreads(qc) as Array<
    [QueryKey, InboxQueryResult | undefined]
  >;

  if (mutation.kind === "remove") {
    const freshItems = snapshots
      .filter(
        ([, data]) =>
          data !== undefined &&
          data.clientSnapshotId > mutation.providerSnapshotFence,
      )
      .flatMap(([, data]) => data?.items ?? []);
    const freshThreadIds = new Set(freshItems.map(threadKeyOf));
    const freshScopes = [
      ...new Set(
        snapshots
          .filter(
            ([, data]) =>
              data !== undefined &&
              data.clientSnapshotId > mutation.providerSnapshotFence,
          )
          .map(([key]) => inboxQueryScope(key)),
      ),
    ];
    for (const threadId of mutation.threadIds) {
      if (freshThreadIds.has(threadId)) return;
      const scopes = mutation.observedQueryScopesByThread[threadId] ?? [];
      const evidenceScopes = scopes.length > 0 ? scopes : freshScopes;
      if (
        evidenceScopes.length === 0 ||
        evidenceScopes.some(
          (scope) =>
            !freshCompleteInboxScope(
              snapshots,
              scope,
              mutation.providerSnapshotFence,
            ),
        )
      ) {
        return;
      }
    }
  } else if (mutation.kind === "star") {
    const freshItems = snapshots
      .filter(
        ([, data]) =>
          data !== undefined &&
          data.clientSnapshotId > mutation.providerSnapshotFence,
      )
      .flatMap(([, data]) => data?.items ?? []);
    const freshItemByThread = new Map(
      freshItems.map((item) => [threadKeyOf(item), item] as const),
    );
    if (
      !mutation.threadIds.every((threadId) => {
        const item = freshItemByThread.get(threadId);
        return item !== undefined && item.isStarred === mutation.isStarred;
      })
    ) {
      return;
    }
  } else {
    const states =
      mutation.kind === "read" ? mutation.states : [mutation.state];
    const freshItemByThread = new Map(
      snapshots
        .filter(
          ([, data]) =>
            data !== undefined &&
            data.clientSnapshotId > mutation.providerSnapshotFence,
        )
        .flatMap(([, data]) => data?.items ?? [])
        .map((item) => [threadKeyOf(item), item] as const),
    );
    if (
      !states.every((state) => {
        const item = freshItemByThread.get(state.threadId);
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
  mutationIds: readonly string[],
): InboxThreadRemovalSnapshot {
  const journal = inboxMutationJournal(qc);
  const snapshot: InboxThreadRemovalSnapshot = [];
  const allowedIds = new Set(mutationIds);
  for (const [id, mutation] of journal) {
    if (
      mutation.kind !== "remove" ||
      !allowedIds.has(id) ||
      !mutation.threadIds.includes(threadId)
    ) {
      continue;
    }
    snapshot.push({ id, mutation, threadId });
    const threadIds = mutation.threadIds.filter((value) => value !== threadId);
    if (threadIds.length === 0) journal.delete(id);
    else
      journal.set(id, {
        ...mutation,
        observedQueryScopesByThread: Object.fromEntries(
          Object.entries(mutation.observedQueryScopesByThread).filter(
            ([value]) => value !== threadId,
          ),
        ),
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
          observedQueryScopesByThread: {
            ...current.observedQueryScopesByThread,
            [threadId]: mutation.observedQueryScopesByThread[threadId] ?? [],
          },
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
      observedQueryScopesByThread: {
        [threadId]: mutation.observedQueryScopesByThread[threadId] ?? [],
      },
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
  const snapshots = snapshotInboxThreads(qc);
  const observedQueryScopesByThread: Record<string, string[]> = {};
  for (const threadId of threadIds) {
    const scopes = new Set<string>();
    for (const [key, data] of snapshots) {
      if (data?.items.some((item) => threadKeyOf(item) === threadId)) {
        scopes.add(inboxQueryScope(key));
      }
    }
    observedQueryScopesByThread[threadId] = [...scopes];
  }
  const cachedThreadIds = new Set(
    Object.entries(observedQueryScopesByThread)
      .filter(([, scopes]) => scopes.length > 0)
      .map(([threadId]) => threadId),
  );
  const mutation = recordInboxMutation(qc, {
    kind: "remove",
    observedThreadIds: [...threadIds].filter((threadId) =>
      cachedThreadIds.has(threadId),
    ),
    observedQueryScopesByThread,
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
