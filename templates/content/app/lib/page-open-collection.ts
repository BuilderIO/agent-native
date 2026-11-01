import { firstSessionReadAnswer } from "@agent-native/core/client/use-session";
import type {
  ContentDatabasePersonalViewResponse,
  ContentDatabaseTableQuery,
  Document,
} from "@shared/api";
import { OPENING_DATABASE_ROW_LIMIT } from "@shared/database-open-table-query";
import {
  hashKey,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import type { PreviewDocumentDraftResponse } from "../hooks/use-documents";
import {
  claimPageOpenRead,
  releasePageOpenRead,
  startPageOpenRead,
  type PageOpenRead,
  type PageOpenReadAdoption,
} from "./page-open-reads";

// What get-page-open-read answers: the page as get-document returns it, with
// the reader's draft, and for a collection's own page the reads its table
// sends first. Each collection part is the answer its own action gives, and a
// part that could not be read is left out for the page to read itself.
export type PageOpenReadAnswer = {
  document: Document & { previewDraft?: PreviewDocumentDraftResponse };
  collection?: {
    database?: unknown;
    personalView?: ContentDatabasePersonalViewResponse;
    rows?: { tableQuery: ContentDatabaseTableQuery; page: unknown };
  };
};

// The collection view a page's address selects, as the collection's table
// reads it: an exact `viewId` first, then the remembered selection
// (DATABASE_VIEW_SELECTION_SEARCH_PARAM). Only the load's own read knows the
// address it opens; any other open leaves the view to the table.
export function loadDatabaseViewId(): string | null {
  if (typeof window === "undefined") return null;
  const search = new URLSearchParams(window.location.search);
  return (
    search.get("viewId")?.trim() || search.get("databaseViewId")?.trim() || null
  );
}

export function openingDatabaseQueryKey(documentId: string) {
  return [
    "action",
    "get-content-database",
    { documentId, limit: OPENING_DATABASE_ROW_LIMIT },
  ] as const;
}

/**
 * Puts the collection parts of a page-open read where the collection's table
 * looks for them, as reads made for this open. Read before the session was
 * known, they are held like the page read: dropped if another account's
 * session answers, and never seeded once one has. A part the page has already
 * read, or is reading, is left to that read.
 */
export function seedPageOpenCollection(
  queryClient: QueryClient,
  documentId: string,
  collection: NonNullable<PageOpenReadAnswer["collection"]>,
  { beforeSession = false }: { beforeSession?: boolean } = {},
) {
  if (beforeSession && firstSessionReadAnswer() === "replaced") return;
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
    const query = queryClient.getQueryCache().find({ queryKey, exact: true });
    if (
      query &&
      (query.state.data !== undefined || query.state.fetchStatus !== "idle")
    ) {
      continue;
    }
    startPageOpenRead(
      queryClient,
      documentId,
      { queryKey, queryFn: () => Promise.resolve(value), retry: false },
      { beforeSession },
    );
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
