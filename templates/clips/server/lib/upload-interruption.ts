export const RETRYABLE_UPLOAD_INTERRUPTION_REASON =
  "Upload was interrupted. The local recording is safe; retry from the Clips desktop app.";

/**
 * Separates the stable prefix the resume fence matches on from the specific
 * diagnosis behind it. The detail used to live only in `application_state`,
 * where no UI reads it, so every interrupted upload looked identical to the
 * owner no matter why it stopped.
 */
const DETAIL_SEPARATOR = " — ";

export function retryableUploadInterruptionReason(
  detail?: string | null,
): string {
  const trimmed = detail?.trim();
  if (!trimmed) return RETRYABLE_UPLOAD_INTERRUPTION_REASON;
  return `${RETRYABLE_UPLOAD_INTERRUPTION_REASON}${DETAIL_SEPARATOR}${trimmed}`.slice(
    0,
    1000,
  );
}

export function isRetryableUploadInterruption(
  failureReason: string | null | undefined,
): boolean {
  if (failureReason === RETRYABLE_UPLOAD_INTERRUPTION_REASON) return true;
  return (
    failureReason?.startsWith(
      `${RETRYABLE_UPLOAD_INTERRUPTION_REASON}${DETAIL_SEPARATOR}`,
    ) === true
  );
}
