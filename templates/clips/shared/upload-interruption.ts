/** Why the reaper failed a row that waited for storage until its lease ran out. */
export const WAITING_STORAGE_EXPIRED_REASON =
  "Storage was never connected, so this upload expired.";

export const RETRYABLE_UPLOAD_INTERRUPTION_REASON =
  "Upload was interrupted. The local recording is safe; retry from the Clips desktop app.";

export function retryableUploadInterruptionReason(
  detail: string | null | undefined,
): string {
  const normalized = detail?.trim();
  return normalized
    ? `${RETRYABLE_UPLOAD_INTERRUPTION_REASON} Last error: ${normalized}`
    : RETRYABLE_UPLOAD_INTERRUPTION_REASON;
}

export function isRetryableUploadInterruption(
  failureReason: string | null | undefined,
): boolean {
  return (
    failureReason === RETRYABLE_UPLOAD_INTERRUPTION_REASON ||
    failureReason?.startsWith(
      `${RETRYABLE_UPLOAD_INTERRUPTION_REASON} Last error:`,
    ) === true
  );
}
