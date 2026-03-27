import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@shared/api";
import type { EnrichmentJob } from "@shared/types";

/**
 * Enrichment jobs for an import from `/api/enrichments?importId=…`.
 * Query key prefix `["enrichments"]` is invalidated by `useFileWatcher` in `app/root.tsx` on file changes.
 */
export function useEnrichmentsForImport(importId: string | null) {
  const { data, ...rest } = useQuery<EnrichmentJob[]>({
    queryKey: ["enrichments", importId],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/enrichments?importId=${encodeURIComponent(importId!)}`,
      );
      if (!res.ok) {
        throw new Error(await res.text());
      }
      return res.json() as Promise<EnrichmentJob[]>;
    },
    enabled: !!importId,
  });

  return { enrichments: data ?? [], ...rest };
}
