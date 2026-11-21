import type {
  ContentDatabaseSource,
  ContentDatabaseSourceWriteMode,
} from "@shared/api";

export function builderSourceRowFetchStatus(
  source: Pick<ContentDatabaseSource, "metadata">,
): "fetching" | "error" | null {
  if (source.metadata.sourceFetchState === "error") return "error";
  if (
    source.metadata.sourceFetchState === "fetching" ||
    source.metadata.lastReadPartial
  ) {
    return "fetching";
  }
  return null;
}

export function builderSourceContinuationKey(
  source: Pick<ContentDatabaseSource, "id" | "metadata">,
) {
  const offset =
    typeof source.metadata.lastReadNextOffset === "number"
      ? source.metadata.lastReadNextOffset
      : null;
  return offset === null ? null : `${source.id}:${offset}`;
}

export function builderSourceContinuationProgressPercent(
  source: Pick<ContentDatabaseSource, "metadata">,
) {
  const fetched = source.metadata.lastReadFetchedEntryCount;
  const limit = source.metadata.lastReadLimit;
  if (typeof fetched !== "number" || typeof limit !== "number" || limit <= 0) {
    return null;
  }
  const rawPercent = Math.max(0, Math.min(100, (fetched / limit) * 100));
  return source.metadata.lastReadHasMore === true
    ? Math.min(95, rawPercent)
    : rawPercent;
}

export function builderSourceContinuationFetchedCountDetail(
  source: Pick<ContentDatabaseSource, "metadata">,
  fetchedCount: number | null,
  rowsComplete = false,
) {
  const knownFetchTotal =
    !rowsComplete &&
    source.metadata.lastReadHasMore === true &&
    typeof source.metadata.lastReadLimit === "number"
      ? source.metadata.lastReadLimit
      : null;
  return fetchedCount !== null &&
    knownFetchTotal !== null &&
    knownFetchTotal > fetchedCount
    ? `${fetchedCount} of ${knownFetchTotal}`
    : fetchedCount;
}

export function builderSourceWriteMode(
  source: Pick<ContentDatabaseSource, "metadata" | "capabilities"> | null,
): ContentDatabaseSourceWriteMode {
  const legacyAllowedWriteModes = source?.metadata.allowedWriteModes ?? [];
  return (
    source?.metadata.writeMode ??
    (source?.capabilities.liveWritesEnabled === true
      ? legacyAllowedWriteModes.some((mode) => mode !== "autosave")
        ? "publish_updates"
        : "stage_only"
      : "read_only")
  );
}
