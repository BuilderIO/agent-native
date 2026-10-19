import type { SourceGenerationResult } from "./source-generation.js";

export interface SqlQueryExecutionMetadata {
  bytesProcessed?: number;
  /** The app served existing rows without executing the query again. */
  cached?: boolean;
  /** The provider reported a query-cache hit; absent means unknown. */
  providerCacheHit?: boolean;
  truncated?: boolean;
  /** When these rows were first received, preserved across cache hits. */
  fetchedAt?: string;
  /**
   * Generation of the warehouse model these rows were read from, as read
   * before the original query; preserved across cache hits. Absent when the
   * rows came from a source without a generation, such as the raw events.
   */
  sourceGeneration?: SourceGenerationResult;
  /** Which table first-party rows read `analytics_events` from, and why. */
  eventsSource?: FirstPartyEventsSource;
}

/**
 * Bytes a response actually scanned: only when both cache layers confirm a
 * miss. A cache hit keeps its first run's bytes, so it scanned nothing now.
 */
export function confirmedScanBytes(
  metadata: SqlQueryExecutionMetadata,
): number | null {
  const bytes = metadata.bytesProcessed;
  if (metadata.cached !== false || metadata.providerCacheHit !== false) {
    return null;
  }
  return typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0
    ? bytes
    : null;
}

/** Why first-party SQL read the raw event table instead of the events model. */
export type FirstPartyEventsModelSkipReason =
  | "not_configured"
  | "raw_requested"
  | "raw_projection"
  | "reads_raw_only_columns"
  | "reads_http_response"
  | "reads_properties_as_text"
  | "model_invalid_table_id"
  | "model_not_found"
  | "model_access_denied";

export type FirstPartyEventsSource =
  | { source: "model"; table: string }
  | { source: "raw"; modelSkipped: FirstPartyEventsModelSkipReason };

export interface SqlQueryRefusal {
  error: string;
  message?: string;
}

export class SqlQueryRefusalError extends Error {
  readonly code: string;

  constructor(refusal: SqlQueryRefusal) {
    super(refusal.message || refusal.error);
    this.name = "SqlQueryRefusalError";
    this.code = refusal.error;
  }
}

export function isConfirmedPreQueryFailure(error: unknown): boolean {
  // The action transport rejects unauthenticated callers before dispatch.
  // Other HTTP failures may originate after a provider submitted the query.
  return (
    error instanceof SqlQueryRefusalError ||
    (error instanceof Error && "status" in error && error.status === 401)
  );
}

export function isSqlQueryAccessDenied(error: unknown): error is Error {
  if (error instanceof SqlQueryRefusalError) {
    return error.code === "missing_api_key";
  }
  return (
    error instanceof Error &&
    "status" in error &&
    (error.status === 401 || error.status === 403 || error.status === 404)
  );
}

export function supportsSqlQueryCacheBypass(source: string): boolean {
  return source === "bigquery";
}
