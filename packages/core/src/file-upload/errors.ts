/**
 * Object storage is required on this host but is absent or unusable.
 *
 * Distinct from `uploadFile()` returning `null`. Null means "no provider is
 * configured, the caller may use its SQL fallback" — an answer that is only
 * safe where SQL is not the last resort for a raw payload. On a host whose
 * object storage is the only writable blob store, returning null hands the
 * file to SQL and reports success, which is the silent degrade this error
 * exists to prevent.
 */
export class FileUploadStorageNotConfiguredError extends Error {
  /** Stable discriminator: `instanceof` is unreliable across bundle splits,
   *  and this error crosses the plugin/handler chunk boundary. */
  readonly code = "file_upload_storage_not_configured";

  constructor(message: string) {
    super(message);
    this.name = "FileUploadStorageNotConfiguredError";
  }
}

export function isFileUploadStorageNotConfiguredError(
  err: unknown,
): err is FileUploadStorageNotConfiguredError {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { code?: unknown }).code === "file_upload_storage_not_configured"
  );
}
