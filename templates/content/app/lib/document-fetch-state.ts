import type { Query, QueryCache } from "@tanstack/react-query";

const successfulFetches = new WeakMap<Query, number>();
let fetchGeneration = 0;

// Cache seeds also increment dataUpdateCount; only a completed queryFn may
// release an editor's failed-load latch.
export function subscribeDocumentFetch(
  cache: QueryCache,
  queryHash: string,
  onChange: () => void,
) {
  return cache.subscribe((event) => {
    if (
      event.query.queryHash === queryHash &&
      event.type === "updated" &&
      event.action.type === "success" &&
      !event.action.manual
    ) {
      successfulFetches.set(event.query, ++fetchGeneration);
      onChange();
    }
  });
}

export function documentFetchCount(cache: QueryCache, queryHash: string) {
  const query = cache.get(queryHash);
  return query ? (successfulFetches.get(query) ?? 0) : 0;
}
