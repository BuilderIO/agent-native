export class RecordingMediaFetchError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
  ) {
    super(message);
    this.name = "RecordingMediaFetchError";
  }
}

export function sanitizeRecordingMediaError(
  error: unknown,
): RecordingMediaFetchError {
  const status =
    typeof error === "object" && error !== null && "statusCode" in error
      ? error.statusCode
      : undefined;
  if (status === 413)
    return new RecordingMediaFetchError("Recording media is too large.", 413);
  if (
    status === 504 ||
    (error instanceof Error && /abort|timeout/i.test(error.name))
  ) {
    return new RecordingMediaFetchError(
      "Recording media fetch timed out.",
      504,
    );
  }
  return new RecordingMediaFetchError(
    "Recording media could not be fetched.",
    502,
  );
}
