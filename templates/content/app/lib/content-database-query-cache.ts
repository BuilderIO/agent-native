import type { ContentDatabaseResponsePayload } from "@shared/api";
import {
  contentDatabaseRowsNeedDefinitions,
  hydrateContentDatabaseResponse,
} from "@shared/database-row-properties";
import { replaceEqualDeep, type QueryClient } from "@tanstack/react-query";

/**
 * Collection reads and writes send each Property definition once, in
 * `properties`, and their rows name Properties by ID. Every write into these
 * queries (a fetch, a write's result, an optimistic update) passes through
 * `shareContentDatabaseQueryData`, so cached rows carry their definitions and
 * readers keep using `item.properties[i].definition`.
 */
export function registerContentDatabaseQueryDefaults(
  queryClient: Pick<QueryClient, "setQueryDefaults">,
) {
  for (const queryKey of [
    ["action", "get-content-database"],
    ["action", "query-content-database-items"],
  ]) {
    queryClient.setQueryDefaults(queryKey, {
      structuralSharing: shareContentDatabaseQueryData,
    });
  }
}

/** React Query's structural sharing, after attaching row definitions. */
export function shareContentDatabaseQueryData(
  previous: unknown,
  next: unknown,
): unknown {
  if (!isContentDatabaseRowsRead(next)) return replaceEqualDeep(previous, next);
  // Unchanged definitions keep their identity, so comparing each row's
  // definitions below stops at the first reference check.
  const properties = replaceEqualDeep(
    (previous as { properties?: unknown } | undefined)?.properties,
    next.properties,
  );
  return replaceEqualDeep(
    previous,
    hydrateContentDatabaseResponse({ ...next, properties }),
  );
}

function isContentDatabaseRowsRead(
  data: unknown,
): data is ContentDatabaseResponsePayload {
  if (!data || typeof data !== "object") return false;
  const read = data as Partial<ContentDatabaseResponsePayload>;
  return (
    Array.isArray(read.items) &&
    Array.isArray(read.properties) &&
    contentDatabaseRowsNeedDefinitions([
      ...read.items,
      ...(read.createdItem ? [read.createdItem] : []),
      ...(read.duplicatedItems ?? []),
    ])
  );
}
