const RETRYABLE_INTAKE_CREATE_STATUSES = new Set([
  408, 409, 425, 429, 500, 502, 503, 504,
]);

export const INTAKE_CREATE_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000] as const;

export async function shouldRetryIntakeCreateResponse(
  response: Response,
): Promise<boolean> {
  if (!RETRYABLE_INTAKE_CREATE_STATUSES.has(response.status)) return false;

  // Typed permanent failures must be surfaced instead of repeating intake
  // creation, which can insert a failed recording on each attempt.
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as {
    errorCode?: string;
    details?: { retryable?: boolean };
  } | null;
  if (
    body?.details?.retryable === false ||
    body?.errorCode === "streaming_upload_unavailable"
  ) {
    return false;
  }

  return true;
}
