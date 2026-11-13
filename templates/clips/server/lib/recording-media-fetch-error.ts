export class RecordingMediaFetchError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
  ) {
    super(message);
    this.name = "RecordingMediaFetchError";
  }
}

export function logFrameMediaCleanupFailure(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  const safeCodes = [
    "EACCES",
    "EPERM",
    "ENOENT",
    "ENOSPC",
    "EBUSY",
    "EIO",
    "EMFILE",
    "ENFILE",
    "EROFS",
    "ENOTEMPTY",
  ];
  console.error(
    "[agent-frame] Media cleanup failed.",
    typeof code === "string" && safeCodes.includes(code) ? code : "UNKNOWN",
  );
}

export function sanitizeRecordingMediaError(
  error: unknown,
): RecordingMediaFetchError {
  const status =
    typeof error === "object" && error !== null && "statusCode" in error
      ? error.statusCode
      : undefined;
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
