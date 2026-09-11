/**
 * Retry policy for per-document reads issued from a surface that already holds
 * an editable snapshot of that document.
 *
 * Optimistic creation navigates to `/page/<id>` before `create-document`
 * commits, so a read keyed to that id can answer 403/404 for a row that is
 * about to exist. The row is also briefly invisible after a real create when
 * the read lands on a lagging connection. Neither is a refusal: the surface
 * only mounted because the document reported `canEdit`, so ride the window out
 * and let a bounded budget expire before surfacing a terminal failure.
 *
 * Every other failure class keeps the caller's existing behavior. This policy
 * only converts "not visible yet" into a retry.
 */

const MAX_RETRIES = 4;

export function isDocumentNotYetVisibleError(error: unknown): boolean {
  const status = (error as { status?: unknown } | undefined)?.status;
  return status === 403 || status === 404;
}

export function retryDocumentScopedRead(
  failureCount: number,
  error: unknown,
): boolean {
  return isDocumentNotYetVisibleError(error) && failureCount < MAX_RETRIES;
}

export function documentScopedReadRetryDelay(failureCount: number): number {
  return Math.min(250 * 2 ** failureCount, 2_000);
}

/** The exact options a document-scoped read passes, so tests cannot drift. */
export const DOCUMENT_SCOPED_READ_RETRY_OPTIONS = {
  retry: retryDocumentScopedRead,
  retryDelay: documentScopedReadRetryDelay,
} as const;
