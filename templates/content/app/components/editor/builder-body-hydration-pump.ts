import type {
  ContentDatabaseSource,
  ProcessBuilderBodyHydrationResponse,
} from "@shared/api";

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

export function builderBodyHydrationProgressKey(
  source: ContentDatabaseSource | null | undefined,
) {
  const summary = source?.bodyHydration;
  if (!source || !summary) return null;
  return [source.id, summary.pending, summary.hydrated, summary.total].join(
    ":",
  );
}

export function builderBodyHydrationMutationMadeProgress(
  result: ProcessBuilderBodyHydrationResponse,
) {
  return result.succeeded > 0 || result.remaining === 0;
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
