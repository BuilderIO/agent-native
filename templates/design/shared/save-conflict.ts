/** The file's content moved past the version the writer based its edit on. */
export const SOURCE_VERSION_CONFLICT_ERROR_CODE = "source_version_conflict";

/**
 * The server could not read the file's live version at all. Nothing is known
 * to have changed, so the write is retryable, unlike a conflict.
 */
export const SOURCE_VERSION_UNVERIFIABLE_ERROR_CODE =
  "source_version_unverifiable";

/** The file a save or read targets no longer exists. */
export const SOURCE_FILE_NOT_FOUND_ERROR_CODE = "source_file_not_found";

/** The typed code a failed action carries, wherever the transport put it. */
export function saveErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as Record<string, unknown>;
  const data =
    candidate.data && typeof candidate.data === "object"
      ? (candidate.data as Record<string, unknown>)
      : undefined;
  const code = candidate.errorCode ?? candidate.code ?? data?.errorCode;
  return typeof code === "string" ? code : undefined;
}
