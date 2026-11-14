import {
  hashKey,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

// React Query clears a query's error as soon as a query with no data is read
// again, so a page refused once would look, while it is re-read, like a
// failure with no reason: after the editor remounts, when sync refetches it,
// or when a page open starts the read before the editor mounts. Each document
// read's last failure is kept here until the read next succeeds on its own (a
// cache write doesn't count) or the query leaves the cache. Tracking starts on
// first use, so every document read calls this before it can fail.
const failuresByClient = new WeakMap<QueryClient, Map<string, unknown>>();

export function trackDocumentReadFailures(queryClient: QueryClient) {
  const existing = failuresByClient.get(queryClient);
  if (existing) return existing;
  const failures = new Map<string, unknown>();
  failuresByClient.set(queryClient, failures);
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "removed") {
      failures.delete(event.query.queryHash);
      return;
    }
    if (event.type !== "updated") return;
    if (event.query.queryKey[1] !== "get-document") return;
    if (event.action.type === "error") {
      failures.set(event.query.queryHash, event.action.error);
    }
    if (event.action.type === "success" && event.action.manual !== true) {
      failures.delete(event.query.queryHash);
    }
  });
  return failures;
}

export function lastDocumentReadFailure(
  queryClient: QueryClient,
  queryKey: QueryKey,
): unknown {
  return trackDocumentReadFailures(queryClient).get(hashKey(queryKey));
}

// The failure a document read's screen is chosen from: the read's own error
// while it has one, otherwise the last one it had.
export function documentReadFailure(
  queryClient: QueryClient,
  queryKey: QueryKey,
  read: { isError: boolean; error: unknown },
): unknown {
  return read.isError
    ? read.error
    : lastDocumentReadFailure(queryClient, queryKey);
}
