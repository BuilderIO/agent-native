import { currentActionQueryCacheBinding } from "@agent-native/core/client/use-action";
import { syncInvalidationsAfter } from "@agent-native/core/client/use-db-sync";
import {
  sessionReadIdentityStatus,
  type SessionReadIdentity,
} from "@agent-native/core/client/use-session";
import type {
  ContentDatabasePersonalViewResponse,
  ContentDatabaseTableQuery,
  Document,
} from "@shared/api";
import { OPENING_DATABASE_ROW_LIMIT } from "@shared/database-open-table-query";
import {
  hashKey,
  partialMatchKey,
  useQueryClient,
  type InvalidateOptions,
  type InvalidateQueryFilters,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import type { PreviewDocumentDraftResponse } from "../hooks/use-documents";
import {
  claimPageOpenRead,
  releasePageOpenRead,
  seedPageOpenRead,
  trackedPageOpenRead,
  type PageOpenRead,
  type PageOpenReadAdoption,
} from "./page-open-reads";

// What get-page-open-read answers: the page as get-document returns it, with
// the reader's draft, and for a collection's own page the reads its table
// sends first. Each collection part is the answer its own action gives, and a
// part that could not be read is left out for the page to read itself.
// `syncCursor` is where the change feed stood before the server read.
export type PageOpenReadAnswer = {
  document: Document & { previewDraft?: PreviewDocumentDraftResponse };
  syncCursor?: string;
  collection?: {
    database?: unknown;
    personalView?: ContentDatabasePersonalViewResponse;
    rows?: { tableQuery: ContentDatabaseTableQuery; page: unknown };
  };
};

// The collection view an address selects, as the collection's table reads
// it: an exact `viewId` first, then the remembered selection
// (DATABASE_VIEW_SELECTION_SEARCH_PARAM). Each open passes the address it is
// opening, which during an in-app navigation is not yet the window's.
export function addressDatabaseViewId(search: string): string | null {
  const params = new URLSearchParams(search);
  return (
    params.get("viewId")?.trim() || params.get("databaseViewId")?.trim() || null
  );
}

export function openingDatabaseQueryKey(documentId: string) {
  return [
    "action",
    "get-content-database",
    { documentId, limit: OPENING_DATABASE_ROW_LIMIT },
  ] as const;
}

// Whom a page-open read was sent for: the page query that sent it, the
// browser cache's binding to an account and organization, and the identity
// it was sent as. An account or organization switch removes, rebinds or
// replaces all three, so a read that answers afterwards belongs to someone
// this tab no longer shows.
// A read spoiled by a change while it was out is no one's current answer.
// A change to one collection part alone leaves the page's answer standing,
// but that part of it is older than the change.
// A read the document head sent went out before this tab could watch for
// changes. Its watch starts from the change feed's cursor its answer names:
// what sync invalidated after that cursor, before the watch began, is played
// into the watch when the answer lands (`answeredAt`, once per read, for the
// page and draft as well as the collection). A key it finds already marked
// invalidated may have changed after the request left too, so that key is
// treated as changed while it was out.
export type PageOpenReadOwner = {
  startedAt: number;
  identity: SessionReadIdentity;
  stillOwns: () => boolean;
  answeredAt: (syncCursor: string | undefined) => void;
  invalidatedWhileOut: (queryKey: QueryKey) => boolean;
  // Called once the read has answered or failed; it stops watching.
  finished: () => void;
};

// The invalidations asked of this client while a page-open read is out. The
// query cache reports an invalidation only for a key it already holds, and a
// collection part may not be cached yet, so the client's own requests are
// recorded as well, by their filters.
type InvalidationWatch = {
  filters: InvalidateQueryFilters[];
  queryHashes: Set<string>;
};
const watchesByClient = new WeakMap<QueryClient, Set<InvalidationWatch>>();

function invalidationWatches(queryClient: QueryClient) {
  const known = watchesByClient.get(queryClient);
  if (known) return known;
  const watches = new Set<InvalidationWatch>();
  watchesByClient.set(queryClient, watches);
  const invalidateQueries = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = ((
    filters?: InvalidateQueryFilters,
    options?: InvalidateOptions,
  ) => {
    for (const watch of watches) watch.filters.push(filters ?? {});
    return invalidateQueries(filters, options);
  }) as QueryClient["invalidateQueries"];
  // A query invalidated directly, not through the client.
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "invalidate") return;
    for (const watch of watches) watch.queryHashes.add(event.query.queryHash);
  });
  return watches;
}

// Whether an invalidation asked with `filters` reaches `queryKey`. Filters
// that decide by the query itself (its type, staleness, a predicate) are
// taken to reach it, since the query may not exist to ask.
function invalidationReaches(
  filters: InvalidateQueryFilters,
  queryKey: QueryKey,
) {
  if (filters.queryKey === undefined) return true;
  return filters.exact
    ? hashKey(filters.queryKey) === hashKey(queryKey)
    : partialMatchKey(queryKey, filters.queryKey);
}

export function pageOpenReadOwner(
  queryClient: QueryClient,
  queryKey: QueryKey,
  signal: AbortSignal,
  identity: SessionReadIdentity,
  // When the request went out, if before now: the head's read.
  sentAt?: number,
): PageOpenReadOwner {
  const startedAt = sentAt ?? Date.now();
  const watchedSinceSent = sentAt === undefined;
  const queryCache = queryClient.getQueryCache();
  const query = queryCache.find({ queryKey, exact: true });
  const binding = currentActionQueryCacheBinding();
  const read = trackedPageOpenRead(queryClient, queryKey);
  const watches = invalidationWatches(queryClient);
  const watch: InvalidationWatch = { filters: [], queryHashes: new Set() };
  watches.add(watch);
  let answered = false;
  return {
    startedAt,
    identity,
    answeredAt: (syncCursor) => {
      if (watchedSinceSent || answered) return;
      answered = true;
      // Unknown, as when the log no longer reaches back that far: every
      // part counts as changed.
      const replayed = syncInvalidationsAfter(queryClient, syncCursor) ?? [{}];
      watch.filters.push(
        ...replayed.map(({ queryKey }) => (queryKey ? { queryKey } : {})),
      );
    },
    invalidatedWhileOut: (partKey) =>
      watch.queryHashes.has(hashKey(partKey)) ||
      watch.filters.some((filters) => invalidationReaches(filters, partKey)) ||
      (!watchedSinceSent &&
        queryCache.find({ queryKey: partKey, exact: true })?.state
          .isInvalidated === true),
    finished: () => {
      watches.delete(watch);
    },
    stillOwns: () =>
      !signal.aborted &&
      query !== undefined &&
      queryCache.find({ queryKey, exact: true }) === query &&
      !query.state.isInvalidated &&
      read?.invalidated !== true &&
      // A read sent before the cache was first bound is checked by its query
      // and identity alone; a binding that untrusted reads must not join
      // removes their queries.
      (binding === undefined || currentActionQueryCacheBinding() === binding) &&
      sessionReadIdentityStatus(identity) !== "stale",
  };
}

/**
 * Puts the collection parts of a page-open read where the collection's table
 * looks for them, as reads made for this open. They carry the page read's
 * identity, so they are held like it: dropped if the session turns out to be
 * someone else's, and never seeded once it has. Nothing is seeded once the
 * read's owner is gone. Every part is dated from the request that read it,
 * so none looks fresher than that request. A part being read now, read since
 * this open's read started, or invalidated while it was out, is left to its
 * own read; one read earlier, say on a previous visit, is replaced.
 */
export function seedPageOpenCollection(
  queryClient: QueryClient,
  documentId: string,
  collection: NonNullable<PageOpenReadAnswer["collection"]>,
  {
    owner,
    syncCursor,
  }: { owner?: PageOpenReadOwner; syncCursor?: string | undefined } = {},
) {
  if (owner && !owner.stillOwns()) return;
  owner?.answeredAt(syncCursor);
  const readStartedAt = owner?.startedAt ?? Date.now();
  const seeds: Array<[QueryKey, unknown]> = [];
  if (collection.database !== undefined) {
    seeds.push([openingDatabaseQueryKey(documentId), collection.database]);
  }
  if (collection.personalView) {
    seeds.push([
      [
        "action",
        "get-content-database-personal-view",
        { databaseId: collection.personalView.databaseId },
      ],
      collection.personalView,
    ]);
  }
  if (collection.rows) {
    seeds.push([
      [
        "action",
        "query-content-database-items",
        {
          documentId,
          limit: OPENING_DATABASE_ROW_LIMIT,
          tableQuery: collection.rows.tableQuery,
        },
      ],
      collection.rows.page,
    ]);
  }
  for (const [queryKey, value] of seeds) {
    if (owner?.invalidatedWhileOut(queryKey)) continue;
    const query = queryClient.getQueryCache().find({ queryKey, exact: true });
    if (
      query &&
      (query.state.fetchStatus !== "idle" ||
        (query.state.data !== undefined &&
          query.state.dataUpdatedAt >= readStartedAt))
    ) {
      continue;
    }
    seedPageOpenRead(queryClient, documentId, queryKey, value, {
      ...(owner ? { identity: owner.identity } : {}),
      startedAt: readStartedAt,
    });
  }
}

// The collection page's read of its table. It is refreshed on every mount
// unless this open has just read it: the first mount takes a landed seed as
// its own read, as the page editor takes the page read.
export function usePageOpenCollectionClaim(queryKey: QueryKey | null) {
  const queryClient = useQueryClient();
  const queryHash = queryKey ? hashKey(queryKey) : null;
  const claimRef = useRef<{
    queryHash: string | null;
    queryKey: QueryKey | null;
    adoption: PageOpenReadAdoption;
    read: PageOpenRead | null;
  } | null>(null);
  if (claimRef.current?.queryHash !== queryHash) {
    claimRef.current =
      claimRef.current === null && queryKey
        ? { queryHash, queryKey, ...claimPageOpenRead(queryClient, queryKey) }
        : { queryHash, queryKey, adoption: "none", read: null };
  }
  const claim = claimRef.current;
  // Runs after the query's own subscription, so from here on a change reaches
  // the read as a mounted query.
  useEffect(() => {
    if (claim.read && claim.queryKey) {
      releasePageOpenRead(queryClient, claim.queryKey, claim.read);
    }
  }, [claim, queryClient]);
  return claim.adoption;
}
