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

// Undefined until the saved last location has loaded.
export function useLastLocationTitleHint(
  options: { enabled?: boolean } = {},
): LandingTitleHint | null | undefined {
  const enabled = options.enabled ?? true;
  const query = useQuery({
    queryKey: CONTENT_LAST_LOCATION_HINT_QUERY_KEY,
    queryFn: fetchLandingTitleHint,
    enabled,
  });
  if (enabled && query.isPending) return undefined;
  return query.data ?? null;
}

// Undefined until a hint names this page's title. The placeholder leaves the
// body out until then, since a title that wraps would move it.
export function useOptimisticDocumentTitle(
  documentId: string | null,
  options: { seededTitle?: string | null; enabled?: boolean } = {},
): string | undefined {
  const lastLocation = useLastLocationTitleHint({
    enabled: (options.enabled ?? true) && !!documentId,
  });
  return useMemo(() => {
    const title = resolveOptimisticDocumentTitle({
      documentId,
      stashed: documentId ? peekLandingTitleHint(documentId) : null,
      lastLocation,
      cachedTitle: options.seededTitle,
    });
    return title ?? undefined;
  }, [documentId, lastLocation, options.seededTitle]);
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
