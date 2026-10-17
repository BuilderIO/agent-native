/**
 * Why a private blob operation failed, as a value callers can branch on.
 * "Absent" (`not_found`/`gone`), "unreadable" (`corrupt`) and "the backend is
 * not there right now" (`not_configured`/`unavailable`) are different facts
 * with different remedies, so none of them may collapse into one message.
 */
export type PrivateBlobFailureKind =
  /** The provider reports that no such object exists. */
  | "not_found"
  /** The object existed and was removed (retention, explicit delete). */
  | "gone"
  /** The stored bytes or handle descriptor cannot be decrypted or parsed. */
  | "corrupt"
  /** No provider can serve this handle in this deployment or request. */
  | "not_configured"
  /** The provider or its transport failed; a later attempt may succeed. */
  | "unavailable";

export class PrivateBlobError extends Error {
  readonly privateBlobError = true;
  readonly kind: PrivateBlobFailureKind;
  readonly status?: number;

  constructor(
    message: string,
    kind: PrivateBlobFailureKind,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "PrivateBlobError";
    this.kind = kind;
    if (options.status !== undefined) this.status = options.status;
  }
}

export function isPrivateBlobError(error: unknown): error is PrivateBlobError {
  return (
    error instanceof PrivateBlobError ||
    (!!error &&
      typeof error === "object" &&
      (error as { privateBlobError?: unknown }).privateBlobError === true &&
      typeof (error as { kind?: unknown }).kind === "string")
  );
}
