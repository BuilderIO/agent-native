import {
  hashKey,
  type FetchQueryOptions,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

// A page open starts its reads before the component that shows them mounts:
// in the layout while the route loads, or on /home while the landing
// resolves. The mounting component adopts a read made for its open instead of
// refetching. A read that was invalidated, failed, cancelled, expired, or
// already adopted is never adopted, so any other mount still reads fresh.
export const PAGE_OPEN_READ_TTL_MS = 10_000;

type PageOpenRead = {
  documentId: string;
  startedAt: number;
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

export function adoptPageOpenRead(
  queryClient: QueryClient,
  queryKey: QueryKey,
): PageOpenReadAdoption {
  const reads = openReads(queryClient);
  const queryHash = hashKey(queryKey);
  const read = reads.get(queryHash);
  if (!read) return "none";
  reads.delete(queryHash);
  const query = queryClient.getQueryCache().get(queryHash);
  if (!query) return "none";
  const usable =
    !read.invalidated &&
    !query.state.isInvalidated &&
    Date.now() - read.startedAt < PAGE_OPEN_READ_TTL_MS;
  if (query.state.fetchStatus !== "idle") {
    if (usable) return "pending";
    // Until the open's own read lands, the fetch in flight is that read, and
    // it may predate the change that spoiled it. A later fetch is left alone.
    if (!read.landed) void queryClient.cancelQueries({ queryKey, exact: true });
    return "none";
  }
  return usable && read.landed ? "fresh" : "none";
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
