import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  CONTENT_LAST_LOCATION_HINT_QUERY_KEY,
  fetchLandingTitleHint,
  peekLandingTitleHint,
  resolveOptimisticDocumentTitle,
  stashLandingTitleHint,
  updateLandingTitleHintCache,
  type LandingTitleHint,
} from "@/lib/document-title-hint";

/**
 * Read of `content-last-location-v1` carrying the last page's id and title.
 * Same-key subscribers (landing route, editor skeleton, pending navigation
 * skeleton) share one request per staleness window; the editor refreshes the
 * cache entry whenever it records a new last location.
 */
export function useLastLocationTitleHint(
  options: { enabled?: boolean } = {},
): LandingTitleHint | null | undefined {
  const query = useQuery({
    queryKey: CONTENT_LAST_LOCATION_HINT_QUERY_KEY,
    queryFn: fetchLandingTitleHint,
    enabled: options.enabled ?? true,
  });
  return query.data ?? null;
}

export function useOptimisticDocumentTitle(
  documentId: string | null,
  options: { seededTitle?: string | null; enabled?: boolean } = {},
): string | null {
  const lastLocation = useLastLocationTitleHint({
    enabled: (options.enabled ?? true) && !!documentId,
  });
  return useMemo(
    () =>
      resolveOptimisticDocumentTitle({
        documentId,
        stashed: documentId ? peekLandingTitleHint(documentId) : null,
        lastLocation,
        cachedTitle: options.seededTitle,
      }),
    [documentId, lastLocation, options.seededTitle],
  );
}

export function stashLandingTitleHintFor(documentId: string, title: string) {
  stashLandingTitleHint({ documentId, title });
}

export function refreshLandingTitleHintCache(
  queryClient: QueryClient,
  documentId: string,
  title: string | null | undefined,
) {
  updateLandingTitleHintCache(queryClient, documentId, title);
}
