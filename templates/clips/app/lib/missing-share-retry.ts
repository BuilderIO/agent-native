const MISSING_SHARE_RETRY_LIMIT = 8;
const MISSING_SHARE_RETRY_INTERVAL_MS = [250, 500, 1000, 2000] as const;

// How long to wait before asking the share API again, or null to stop. A 404
// means "the share row isn't written yet" only while the loader has not found
// the clip. Once it has (loaderFoundClip), the API returns 404 for a viewer
// without access, so retrying only delays the request-access screen.
export function missingShareRetryDelayMs({
  status,
  updateCount,
  loaderFoundClip,
}: {
  status: number | undefined;
  updateCount: number;
  loaderFoundClip: boolean;
}): number | null {
  if (status !== 404 || loaderFoundClip) return null;
  if (updateCount >= MISSING_SHARE_RETRY_LIMIT) return null;
  return MISSING_SHARE_RETRY_INTERVAL_MS[updateCount - 1] ?? 2000;
}
