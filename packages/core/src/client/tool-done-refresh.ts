import type { Query, QueryClient } from "@tanstack/react-query";

import { isTerminalAuthFailure } from "./create-query-client.js";

const dbSyncClientCounts = new WeakMap<object, number>();
const fallbackClientEntries = new WeakMap<
  QueryClient,
  { count: number; listener: (event: Event) => void }
>();
const fallbackInvalidatedClients = new WeakMap<Event, WeakSet<QueryClient>>();

export function registerDbSyncQueryClient(queryClient: object): () => void {
  dbSyncClientCounts.set(
    queryClient,
    (dbSyncClientCounts.get(queryClient) ?? 0) + 1,
  );
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (dbSyncClientCounts.get(queryClient) ?? 1) - 1;
    if (next <= 0) {
      dbSyncClientCounts.delete(queryClient);
    } else {
      dbSyncClientCounts.set(queryClient, next);
    }
  };
}

export function hasDbSyncForQueryClient(queryClient: object): boolean {
  return (dbSyncClientCounts.get(queryClient) ?? 0) > 0;
}

function invalidateActionQueriesInPlace(queryClient: QueryClient): void {
  const matchesActionQuery = (query: Query) =>
    !isTerminalAuthFailure(query.state.error);
  const busyQueries = new Set<Query>();
  queryClient.isFetching({
    queryKey: ["action"],
    predicate: (query: Query) => {
      const matches = matchesActionQuery(query);
      if (matches) busyQueries.add(query);
      return matches;
    },
  });
  const completion = queryClient.invalidateQueries(
    {
      queryKey: ["action"],
      predicate: matchesActionQuery,
    },
    { cancelRefetch: false },
  );
  if (busyQueries.size > 0) {
    void completion.then(() => {
      if (!fallbackClientEntries.has(queryClient)) return;
      void queryClient.invalidateQueries({
        queryKey: ["action"],
        predicate: (query: Query) =>
          busyQueries.has(query) && matchesActionQuery(query),
      });
    });
  }
}

export function retainFallbackToolDoneRefresh(
  queryClient: QueryClient,
): () => void {
  if (typeof window === "undefined") return () => {};
  let entry = fallbackClientEntries.get(queryClient);
  if (!entry) {
    const listener = (event: Event) => {
      if (hasDbSyncForQueryClient(queryClient)) return;
      const detail = (
        event as CustomEvent<
          | {
              tool?: unknown;
              completedSideEffect?: unknown;
            }
          | null
          | undefined
        >
      ).detail;
      if (typeof detail?.tool !== "string") return;
      if (detail.completedSideEffect !== true) return;
      let clients = fallbackInvalidatedClients.get(event);
      if (!clients) {
        clients = new WeakSet<QueryClient>();
        fallbackInvalidatedClients.set(event, clients);
      }
      if (clients.has(queryClient)) return;
      clients.add(queryClient);
      invalidateActionQueriesInPlace(queryClient);
    };
    window.addEventListener("agent-native:tool-done", listener);
    entry = { count: 0, listener };
    fallbackClientEntries.set(queryClient, entry);
  }
  entry.count += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = fallbackClientEntries.get(queryClient);
    if (!current) return;
    current.count -= 1;
    if (current.count <= 0) {
      window.removeEventListener("agent-native:tool-done", current.listener);
      fallbackClientEntries.delete(queryClient);
    }
  };
}
