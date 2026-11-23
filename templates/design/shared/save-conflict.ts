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

/**
 * A tweak snapshot was based on selections the design no longer holds. Sending
 * the same snapshot again can never succeed.
 */
export const TWEAK_SELECTIONS_CONFLICT_ERROR_CODE = "tweak_selections_conflict";

/** The typed code a failed action carries, wherever the transport put it. */
export function saveErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as Record<string, unknown>;
  const data =
    candidate.data && typeof candidate.data === "object"
      ? (candidate.data as Record<string, unknown>)
      : undefined;
  const code = candidate.errorCode ?? candidate.code ?? data?.errorCode;
  if (typeof code !== "string" || TRANSPORT_ERROR_CODES.has(code))
    return undefined;
  return code;
}

const TRANSPORT_ERROR_CODES = new Set([
  "request_failed",
  "network_error",
  "timeout",
]);

export function saveErrorDiagnostic(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const { name, message, cause } = error as {
    name?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  const own = typeof message === "string" ? message : "";
  if (name !== "ActionError" || !cause || typeof cause !== "object") return own;
  const raw = (cause as { message?: unknown }).message;
  return typeof raw === "string" && raw ? `${own}\n${raw}` : own;
}
