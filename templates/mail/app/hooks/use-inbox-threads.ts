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

export const INBOX_THREADS_QUERY_KEY = ["action", "list-inbox-threads"];

const SYNCING_POLL_MS = 3_000;
const IDLE_POLL_MS = 20_000;
const INBOX_THREADS_STALE_TIME_MS = IDLE_POLL_MS;

export type InboxOverview = Pick<
  ListInboxThreadsResult,
  "tabs" | "syncing" | "accounts" | "labels"
> & { clientSnapshotId: number };

type InboxPageCountSnapshot = Pick<
  ListInboxThreadsResult,
  "activeTabId" | "tabs"
> & { clientSnapshotId: number };

export function mergeOptimisticInboxTabCounts(
  overview: Pick<InboxOverview, "tabs" | "clientSnapshotId">,
  base: InboxPageCountSnapshot | undefined,
  projected: InboxPageCountSnapshot | undefined,
) {
  if (
    !base ||
    !projected ||
    base.clientSnapshotId !== overview.clientSnapshotId ||
    projected.clientSnapshotId !== overview.clientSnapshotId ||
    base.activeTabId !== projected.activeTabId
  ) {
    return overview.tabs;
  }
  const baseTab = base.tabs.find((tab) => tab.id === base.activeTabId);
  const projectedTab = projected.tabs.find(
    (tab) => tab.id === projected.activeTabId,
  );
  if (!baseTab || !projectedTab) return overview.tabs;

  const totalDelta = projectedTab.total - baseTab.total;
  const unreadDelta = projectedTab.unread - baseTab.unread;
  if (totalDelta === 0 && unreadDelta === 0) return overview.tabs;

  return overview.tabs.map((tab) =>
    tab.id === projectedTab.id
      ? {
          ...tab,
          total: Math.max(0, tab.total + totalDelta),
          unread: Math.max(0, tab.unread + unreadDelta),
        }
      : tab,
  );
}

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

export function useInboxOverview(accountEmails?: readonly string[]) {
  return useQuery<InboxOverview>({
    queryKey: inboxOverviewQueryKey(accountEmails),
    queryFn: skipToken,
    staleTime: Infinity,
  });
}

export function isUnauthorizedError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "status" in error &&
    ((error as { status?: unknown }).status === 401 ||
      (error as { status?: unknown }).status === 403)
  );
}

export function inboxThreadsRefetchInterval(query: {
  state: { error: unknown; data?: { syncing?: boolean } };
}): number | false {
  if (isUnauthorizedError(query.state.error)) return false;
  return query.state.data?.syncing ? SYNCING_POLL_MS : IDLE_POLL_MS;
}

export const INBOX_PAGE_SIZE = 100;

type InboxQueryResult = ListInboxThreadsResult & {
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
    refetchInterval: inboxThreadsRefetchInterval,
    staleTime: INBOX_THREADS_STALE_TIME_MS,
    placeholderData: keepPreviousData,
    select: (data) => applyInboxMutationOverlay(qc, data) as InboxQueryResult,
  });
}

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

export function mergeInboxThreadPages(
  pages: ReadonlyArray<Pick<ListInboxThreadsResult, "items"> | undefined>,
): InboxThreadItem[] {
  return pages.flatMap((page) => page?.items ?? []);
}

export function inboxThreadsHasNextPage(
  loadedCount: number,
  total: number,
): boolean {
  return loadedCount < total;
}

export function invalidateInboxThreads(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: INBOX_THREADS_QUERY_KEY });
}

export function snapshotInboxThreads(qc: QueryClient) {
  return qc.getQueriesData<ListInboxThreadsResult>({
    queryKey: INBOX_THREADS_QUERY_KEY,
  });
}

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

export function restoreInboxThreadsOptimistic(
  qc: QueryClient,
  snapshot: ReturnType<typeof snapshotInboxThreads>,
) {
  for (const [key, data] of snapshot) qc.setQueryData(key, data);
}

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
