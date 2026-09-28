const MAX_RETRIES = 4;

const CREATE_SETTLING_WINDOW_MS = 60_000;

export function isDocumentNotYetVisibleError(error: unknown): boolean {
  const status = (error as { status?: unknown } | undefined)?.status;
  return status === 403 || status === 404;
}

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

export function documentScopedReadRetryOptions(settling: boolean) {
  return {
    retry: (failureCount: number, error: unknown) =>
      settling &&
      isDocumentNotYetVisibleError(error) &&
      failureCount < MAX_RETRIES,
    retryDelay: documentScopedReadRetryDelay,
  };
}
