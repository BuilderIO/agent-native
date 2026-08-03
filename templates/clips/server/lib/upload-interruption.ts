export const RETRYABLE_UPLOAD_INTERRUPTION_REASON =
  "Upload was interrupted. The local recording is safe; retry from the Clips desktop app.";

export function isRetryableUploadInterruption(
  failureReason: string | null | undefined,
): boolean {
  return failureReason === RETRYABLE_UPLOAD_INTERRUPTION_REASON;
}
