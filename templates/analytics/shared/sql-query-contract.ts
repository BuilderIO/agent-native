export interface SqlQueryExecutionMetadata {
  bytesProcessed?: number;
  /** The app served existing rows without executing the query again. */
  cached?: boolean;
  /** The provider reported a query-cache hit; absent means unknown. */
  providerCacheHit?: boolean;
  truncated?: boolean;
  /** When these rows were first received, preserved across cache hits. */
  fetchedAt?: string;
}

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
