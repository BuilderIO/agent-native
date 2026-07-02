import type { ContentDatabaseSource } from "@shared/api";

export function builderBodyHydrationPumpKey(
  source: ContentDatabaseSource | null | undefined,
) {
  const summary = source?.bodyHydration;
  if (!source || !summary) return null;
  return [
    source.id,
    summary.pending,
    summary.hydrating,
    summary.hydrated,
    summary.error,
    summary.total,
  ].join(":");
}

export function shouldPumpBuilderBodyHydration(
  source: ContentDatabaseSource | null | undefined,
  isPending: boolean,
  errorKey: string | null,
) {
  const summary = source?.bodyHydration;
  const key = builderBodyHydrationPumpKey(source);
  if (!source || source.sourceType !== "builder-cms" || !summary || !key) {
    return false;
  }
  if (source.metadata.federation?.role === "secondary") return false;
  if (isPending || errorKey === key) return false;
  if (source.metadata.lastReadHasMore === true) return false;
  if (source.metadata.sourceFetchState === "fetching") return false;
  return summary.pending + summary.hydrating > 0;
}
