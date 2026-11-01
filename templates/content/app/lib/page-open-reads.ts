import {
  firstSessionReadAnswer,
  subscribeFirstSessionReadAnswer,
} from "@agent-native/core/client/use-session";
import {
  hashKey,
  type FetchQueryOptions,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

// A page open starts its reads before the component that shows them mounts:
// at load before the session is known, in the layout while the route loads,
// or on /home while the landing resolves. The mounting component adopts a read made for its open instead of
// refetching. A read that was spoiled, failed, cancelled, expired, or already
// adopted is never adopted, so any other mount still reads fresh.
export const PAGE_OPEN_READ_TTL_MS = 10_000;

export type PageOpenRead = {
  documentId: string;
  startedAt: number;
  // Spoiled by an invalidation, a peer change arriving through sync, or this
  // tab saving the page, from the moment the read starts until its adopting
  // component has mounted.
  invalidated: boolean;
  // Set only by a fetch's own success. A cache write (`setQueryData`) is a
  // manual success and never counts: a read cancelled by an optimistic update
  // leaves the older cached body behind with a fresh timestamp.
  landed: boolean;
  // Sent before the session was known, with whatever account the cookies
  // named then. Cleared once the load's first session read answers for it.
  beforeSession: boolean;
};

export type PageOpenReadAdoption = "fresh" | "pending" | "none";

const readsByClient = new WeakMap<QueryClient, Map<string, PageOpenRead>>();

// Reads sent before the session was known, claimed or not, until the load's
// first session read answers: they are kept when it does, and dropped when a
// retry or an invalidation answers instead. Each waits on the answer, so the
// claim does not have to.
type HeldForSession = {
  reads: Map<string, { queryKey: QueryKey; read: PageOpenRead }>;
  whenKept: Array<() => void>;
  unsubscribe: () => void;
};
const heldByClient = new WeakMap<QueryClient, HeldForSession>();

function holdForSession(queryClient: QueryClient): HeldForSession {
  let held = heldByClient.get(queryClient);
  if (!held) {
    const created: HeldForSession = {
      reads: new Map(),
      whenKept: [],
      unsubscribe: subscribeFirstSessionReadAnswer(() =>
        settleHeldReads(queryClient),
      ),
    };
    heldByClient.set(queryClient, created);
    held = created;
  }
  return held;
}

// Runs before the app behind the session gate is shown: the session store
// calls it in the task that answers, ahead of its own subscribers.
function settleHeldReads(queryClient: QueryClient) {
  const answer = firstSessionReadAnswer();
  if (answer === "pending") return;
  const held = heldByClient.get(queryClient);
  if (!held) return;
  heldByClient.delete(queryClient);
  held.unsubscribe();
  if (answer === "first-read") {
    for (const { read } of held.reads.values()) read.beforeSession = false;
    for (const kept of held.whenKept) kept();
    return;
  }
  dropReadsBeforeSession(queryClient, held);
}

// Runs `callback` once the load's first session read keeps the reads sent
// before it, and never if another read answers instead. Once the session is
// known, a read sent now is like any other, so it runs at once.
export function whenReadsBeforeSessionKept(
  queryClient: QueryClient,
  callback: () => void,
) {
  if (firstSessionReadAnswer() === "pending") {
    holdForSession(queryClient).whenKept.push(callback);
  } else {
    callback();
  }
}

// Whether this read went out before the session was known and the load's
// first session read has not answered yet. It may hold another account's
// page, so nothing may be shown from it until that read answers.
export function isAwaitingSession(read: PageOpenRead | null) {
  return read?.beforeSession === true && firstSessionReadAnswer() === "pending";
}

function openReads(queryClient: QueryClient) {
  let reads = readsByClient.get(queryClient);
  if (!reads) {
    reads = new Map();
    readsByClient.set(queryClient, reads);
    queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "removed") {
        reads!.delete(event.query.queryHash);
        return;
      }
      if (event.type !== "updated") return;
      const read = reads!.get(event.query.queryHash);
      if (!read) return;
      if (event.action.type === "invalidate") read.invalidated = true;
      if (event.action.type === "success" && event.action.manual !== true) {
        read.landed = true;
      }
    });
  }
  return reads;
}

// Returns whether it started a read; one made for this open already counts.
export function startPageOpenRead<TData>(
  queryClient: QueryClient,
  documentId: string,
  options: FetchQueryOptions<TData, Error, TData, QueryKey>,
  { beforeSession = false }: { beforeSession?: boolean } = {},
): boolean {
  const reads = openReads(queryClient);
  const queryHash = hashKey(options.queryKey);
  const current = reads.get(queryHash);
  if (
    current &&
    !current.invalidated &&
    Date.now() - current.startedAt < PAGE_OPEN_READ_TTL_MS
  ) {
    return false;
  }
  const query = queryClient
    .getQueryCache()
    .find({ queryKey: options.queryKey, exact: true });
  // A fetch already in flight may predate this open, or be a spoiled earlier
  // read; the new read must not join it. Cancelling reverts the query at once.
  if (query && query.state.fetchStatus !== "idle") {
    void queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
  }
  // An already-invalidated query dispatches no further invalidate events, so
  // clear the flag before this read replaces its data; otherwise a change that
  // lands while the read is in flight would go unnoticed.
  if (query?.state.isInvalidated) {
    query.setState({ ...query.state, isInvalidated: false });
  }
  // Once the session has answered, a read sent now carries the cookies
  // that answer belongs to, like any other read.
  const heldForSession =
    beforeSession && firstSessionReadAnswer() === "pending";
  const read: PageOpenRead = {
    documentId,
    startedAt: Date.now(),
    invalidated: false,
    landed: false,
    beforeSession: heldForSession,
  };
  reads.set(queryHash, read);
  if (heldForSession) {
    holdForSession(queryClient).reads.set(queryHash, {
      queryKey: options.queryKey,
      read,
    });
  }
  void queryClient.prefetchQuery({ ...options, staleTime: 0 });
  return true;
}

export function isPageOpenRead(queryClient: QueryClient, queryKey: QueryKey) {
  return openReads(queryClient).has(hashKey(queryKey));
}

// Claims the read made for this open. A claimed read stays tracked until
// `releasePageOpenRead`, so a change that arrives before the claiming
// component subscribes still spoils it.
export function claimPageOpenRead(
  queryClient: QueryClient,
  queryKey: QueryKey,
): { adoption: PageOpenReadAdoption; read: PageOpenRead | null } {
  const reads = openReads(queryClient);
  const queryHash = hashKey(queryKey);
  const read = reads.get(queryHash);
  if (!read) return { adoption: "none", read: null };
  // Settled reads were already kept or dropped; one still held is adopted,
  // and the session's answer decides it before anything shows it.
  if (read.beforeSession && firstSessionReadAnswer() === "replaced") {
    settleHeldReads(queryClient);
    reads.delete(queryHash);
    void queryClient.resetQueries({ queryKey, exact: true });
    return { adoption: "none", read: null };
  }
  const query = queryClient.getQueryCache().get(queryHash);
  const usable =
    !!query &&
    !read.invalidated &&
    !query.state.isInvalidated &&
    Date.now() - read.startedAt < PAGE_OPEN_READ_TTL_MS;
  const adoption: PageOpenReadAdoption = !query
    ? "none"
    : query.state.fetchStatus !== "idle"
      ? usable
        ? "pending"
        : "none"
      : usable && read.landed
        ? "fresh"
        : "none";
  if (adoption === "none") {
    reads.delete(queryHash);
    // Until the open's own read lands, the fetch in flight is that read, and
    // it may predate the change that spoiled it. A later fetch is left alone.
    if (query && query.state.fetchStatus !== "idle" && !read.landed) {
      void queryClient.cancelQueries({ queryKey, exact: true });
    }
    return { adoption, read: null };
  }
  return { adoption, read };
}

// The session that answered is not the one the load asked alongside these
// reads, so they may hold another account's page or draft. None of them is
// shown, and a component already holding one reads it again.
function dropReadsBeforeSession(
  queryClient: QueryClient,
  held: HeldForSession,
) {
  const reads = openReads(queryClient);
  for (const [queryHash, { queryKey, read }] of held.reads) {
    if (reads.get(queryHash) === read) reads.delete(queryHash);
    void queryClient.resetQueries({ queryKey, exact: true });
  }
}

// Called once the claiming component is subscribed. A read spoiled after it
// was claimed is replaced by a fresh one.
export function releasePageOpenRead(
  queryClient: QueryClient,
  queryKey: QueryKey,
  read: PageOpenRead,
) {
  const reads = openReads(queryClient);
  const queryHash = hashKey(queryKey);
  if (reads.get(queryHash) === read) reads.delete(queryHash);
  if (!read.invalidated) return;
  void queryClient.cancelQueries({ queryKey, exact: true });
  void queryClient.refetchQueries({ queryKey, exact: true });
}

export function adoptPageOpenRead(
  queryClient: QueryClient,
  queryKey: QueryKey,
): PageOpenReadAdoption {
  const { adoption, read } = claimPageOpenRead(queryClient, queryKey);
  if (read) openReads(queryClient).delete(hashKey(queryKey));
  return adoption;
}

// This tab is changing the page, so no read already under way for it can be
// shown as the page's current state.
export function spoilPageOpenReads(
  queryClient: QueryClient,
  documentId: string,
) {
  for (const read of openReads(queryClient).values()) {
    if (read.documentId === documentId) read.invalidated = true;
  }
}

export function retirePageOpenReads(
  queryClient: QueryClient,
  keepDocumentId: string | null,
) {
  const reads = openReads(queryClient);
  for (const [queryHash, read] of reads) {
    if (read.documentId !== keepDocumentId) reads.delete(queryHash);
  }
}
