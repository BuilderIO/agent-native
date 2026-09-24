/**
 * Retry policy for per-document reads issued from a surface that already holds
 * an editable snapshot of that document.
 *
 * Optimistic creation navigates to `/page/<id>` before `create-document`
 * commits, so a read keyed to that id can answer 403/404 for a row that is
 * about to exist. The row is also briefly invisible after a real create when
 * the read lands on a lagging connection. Riding that window out is what keeps
 * a just-created page from rendering a terminal failure for its own row.
 *
 * The window has to be bounded by more than a status code. `assertAccess`
 * answers 403 both for a row that is not there yet and for a share that was
 * genuinely revoked, and these reads are invalidated on sync events — so
 * retrying every 403 would turn each poll cycle into five unauthorized requests
 * for a user who simply lost access. Only a row whose own creation could still
 * be settling gets the budget; outside that window a refusal is a real answer
 * and stays terminal on the first attempt.
 *
 * Every other failure class keeps the caller's existing behavior.
 */

const MAX_RETRIES = 4;

/** How long after a row is created its own reads may still answer 403/404. */
const CREATE_SETTLING_WINDOW_MS = 60_000;

export function isDocumentNotYetVisibleError(error: unknown): boolean {
  const status = (error as { status?: unknown } | undefined)?.status;
  return status === 403 || status === 404;
}

/**
 * Whether this document is young enough that its own creation could still be
 * settling. An optimistic row carries a client timestamp and a committed row
 * carries a server one, so a skewed clock reads as a large age in either
 * direction and degrades to no retry rather than to a wrong answer.
 */
export function isWithinCreateSettlingWindow(
  createdAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  return Math.abs(now - created) < CREATE_SETTLING_WINDOW_MS;
}

export function documentScopedReadRetryDelay(failureCount: number): number {
  return Math.min(250 * 2 ** failureCount, 2_000);
}

/**
 * The exact options a document-scoped read passes, so tests cannot drift from
 * production. `settling` comes from the caller's own document snapshot.
 */
export function documentScopedReadRetryOptions(settling: boolean) {
  return {
    retry: (failureCount: number, error: unknown) =>
      settling &&
      isDocumentNotYetVisibleError(error) &&
      failureCount < MAX_RETRIES,
    retryDelay: documentScopedReadRetryDelay,
  };
}
