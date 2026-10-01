import {
  hashKey,
  type FetchQueryOptions,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

// A page open starts its reads before the component that shows them mounts:
// in the layout while the route loads, or on /home while the landing
// resolves. The mounting component adopts a read made for its open instead of
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
};

export type PageOpenReadAdoption = "fresh" | "pending" | "none";

const readsByClient = new WeakMap<QueryClient, Map<string, PageOpenRead>>();

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

export function startPageOpenRead<TData>(
  queryClient: QueryClient,
  documentId: string,
  options: FetchQueryOptions<TData, Error, TData, QueryKey>,
) {
  const reads = openReads(queryClient);
  const queryHash = hashKey(options.queryKey);
  const current = reads.get(queryHash);
  if (
    current &&
    !current.invalidated &&
    Date.now() - current.startedAt < PAGE_OPEN_READ_TTL_MS
  ) {
    return;
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
  reads.set(queryHash, {
    documentId,
    startedAt: Date.now(),
    invalidated: false,
    landed: false,
  });
  void queryClient.prefetchQuery({ ...options, staleTime: 0 });
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
