/**
 * Turns an `AttachmentFailure` into the one error every action surface
 * (agent tool, HTTP action route, A2A) throws. The decision "does this end the
 * run?" is made here from the typed status, never from message text:
 *
 * - `notFound`, `forbiddenScope`, `expired`, `malformed` are definitive: the
 *   same ref can never succeed, so they stop the turn as `permanent_precondition`
 *   with a message that names the real cause and tells the user to attach again.
 * - `storageUnavailable` is the only retryable outcome. It is an ordinary
 *   action error (never a stop) and tells the model the ref is still valid.
 */
import {
  isRetryableAttachmentFailure,
  type AttachmentFailure,
  type AttachmentFile,
  type AttachmentResolution,
} from "./attachment-ref.js";

export const ATTACHMENT_ERROR_CODES = {
  notFound: "attachment_not_found",
  forbiddenScope: "attachment_forbidden_scope",
  expired: "attachment_expired",
  malformed: "attachment_malformed",
  storageUnavailable: "attachment_storage_unavailable",
} as const satisfies Record<AttachmentFailure["status"], string>;

export type AttachmentErrorCode =
  (typeof ATTACHMENT_ERROR_CODES)[AttachmentFailure["status"]];

const ATTACHMENT_STATUS_CODES = {
  notFound: 404,
  forbiddenScope: 403,
  expired: 410,
  malformed: 400,
  storageUnavailable: 503,
} as const satisfies Record<AttachmentFailure["status"], number>;

/** What the caller reads off `error.details` instead of parsing the message. */
export interface AttachmentFailureDetails extends Record<string, unknown> {
  attachmentStatus: AttachmentFailure["status"];
  attachmentErrorCode: AttachmentErrorCode;
  reason: string;
  retryable: boolean;
  whoCanFix?: "workspace_admin" | "operator" | "self_resolving";
}

export interface AttachmentFailureDescription {
  /** User-facing: says what is wrong and what to do. */
  message: string;
  /** Model-facing: the same cause plus whether to retry. */
  toolResult: string;
}

const REATTACH = "Attach the file again.";

function subject(failure: AttachmentFailure): string {
  const filename = "filename" in failure ? failure.filename : undefined;
  return filename ? `The uploaded file "${filename}"` : "The uploaded file";
}

/** Whether the caller was saving a new file or opening a stored one. */
export type AttachmentOperation = "save" | "open";

/**
 * One message serves the user and the model: it names the cause and who can
 * fix it, and when opening says the stored file is intact, so neither is led
 * to ask for it to be attached again.
 */
function describeStorageUnavailable(
  failure: Extract<AttachmentFailure, { status: "storageUnavailable" }>,
  operation: AttachmentOperation,
): AttachmentFailureDescription {
  const saved =
    operation === "open" ? " Your uploaded file is still saved." : "";
  const cause = (() => {
    switch (failure.reason) {
      case "not_configured":
        return "No object storage is connected. Use Builder.io's managed storage (free) or configure your own S3-compatible storage keys in Settings → File uploads.";
      case "encryption_key_unavailable":
        return "File storage is unavailable because this deployment has no encryption key configured.";
      case "misconfigured":
        return "File storage is configured incorrectly on this deployment.";
      case "provider_unavailable":
        return "File storage isn't responding right now. Try again in a moment.";
    }
  })();
  const message = `${cause}${saved}`;
  return { message, toolResult: message };
}

export function describeAttachmentFailure(
  failure: AttachmentFailure,
  operation: AttachmentOperation = "open",
): AttachmentFailureDescription {
  const stop = (message: string, guidance: string) => ({
    message,
    toolResult: `${message} ${guidance}`,
  });
  switch (failure.status) {
    case "notFound":
      return stop(
        `${subject(failure)} is no longer in file storage. ${REATTACH}`,
        "Do not retry this filePath; ask the user to attach the file again.",
      );
    case "forbiddenScope":
      return failure.reason === "org_mismatch"
        ? stop(
            "This uploaded file was added in a different workspace than the one that is active now. Switch back to that workspace or attach the file again.",
            "Do not retry this filePath; ask the user to switch workspace or attach the file again.",
          )
        : failure.reason === "path_outside_uploads"
          ? stop(
              "That file path is outside the current user's uploads.",
              "Do not retry this filePath; use the upload reference listed for the attachment or ask the user to upload the file.",
            )
          : stop(
              "This uploaded file belongs to a different user, so it can't be opened here.",
              "Do not retry this filePath; ask the user to attach a file they can access.",
            );
    case "expired":
      return failure.reason === "retention"
        ? stop(
            `${subject(failure)} has expired from file storage. ${REATTACH}`,
            "Do not retry this filePath; ask the user to attach the file again.",
          )
        : stop(
            `This uploaded file reference can't be decoded. It was cut short or altered when it was copied, or it was created before the app's encryption settings changed. ${REATTACH}`,
            "Do not retry this filePath; ask the user to attach the file again.",
          );
    case "malformed":
      return failure.reason === "unrecognized_scheme"
        ? stop(
            "The filePath is neither an uploaded file reference nor the name of a file attached to this message. Use the exact reference listed for the attachment.",
            "Do not retry this value; use the reference listed for the attachment or ask the user to attach the file again.",
          )
        : failure.reason === "empty"
          ? stop(
              "No uploaded file reference was provided.",
              "Pass the reference listed for the attachment, or ask the user to attach the file.",
            )
          : stop(
              `This uploaded file reference is malformed. ${REATTACH}`,
              "Do not retry this filePath; ask the user to attach the file again.",
            );
    case "storageUnavailable":
      return describeStorageUnavailable(failure, operation);
  }
}

export function attachmentFailureDetails(
  failure: AttachmentFailure,
): AttachmentFailureDetails {
  return {
    attachmentStatus: failure.status,
    attachmentErrorCode: ATTACHMENT_ERROR_CODES[failure.status],
    reason: failure.reason,
    retryable: isRetryableAttachmentFailure(failure),
    ...(failure.status === "storageUnavailable"
      ? { whoCanFix: failure.whoCanFix }
      : {}),
  };
}

// These errors carry the action runtime's duck-typed markers
// (`agentNativeStop` / `actionContractError`, the same shape
// `isAgentActionStopError` and `isActionContractError` accept) instead of
// extending the classes in action.ts: private-blob is a storage layer that
// every upload path loads, and importing action.ts here made any test or
// bundle that stubs `@agent-native/core/action` fail at module load.

/**
 * A definitive attachment failure. It is a stop for the agent
 * (`permanent_precondition`) and carries a real HTTP status so the action
 * route answers 404/403/410/400 rather than an opaque 500.
 */
export class AttachmentUnavailableError extends Error {
  readonly agentNativeStop = true;
  readonly errorCode = "permanent_precondition";
  readonly details: AttachmentFailureDetails;
  readonly toolResult: string | undefined;
  readonly statusCode: number;
  readonly failure: AttachmentFailure;

  constructor(failure: AttachmentFailure) {
    const description = describeAttachmentFailure(failure);
    super(description.message);
    this.name = "AttachmentUnavailableError";
    this.details = attachmentFailureDetails(failure);
    this.toolResult = description.toolResult;
    this.statusCode = ATTACHMENT_STATUS_CODES[failure.status];
    this.failure = failure;
  }
}

/** The retryable outcome: an ordinary typed action error, never a stop. */
export class AttachmentStorageUnavailableError extends Error {
  readonly actionContractError = true;
  readonly errorCode: string = ATTACHMENT_ERROR_CODES.storageUnavailable;
  readonly details: AttachmentFailureDetails;
  readonly statusCode: number = ATTACHMENT_STATUS_CODES.storageUnavailable;
  readonly failure: Extract<
    AttachmentFailure,
    { status: "storageUnavailable" }
  >;

  constructor(
    failure: Extract<AttachmentFailure, { status: "storageUnavailable" }>,
    operation: AttachmentOperation = "open",
  ) {
    super(describeAttachmentFailure(failure, operation).message);
    this.name = "AttachmentStorageUnavailableError";
    this.details = attachmentFailureDetails(failure);
    this.failure = failure;
  }
}

export function attachmentFailureToError(
  failure: AttachmentFailure,
  operation: AttachmentOperation = "open",
): AttachmentUnavailableError | AttachmentStorageUnavailableError {
  return failure.status === "storageUnavailable"
    ? new AttachmentStorageUnavailableError(failure, operation)
    : new AttachmentUnavailableError(failure);
}

/** Returns the file, or throws the typed error for the failure. */
export function unwrapAttachment(
  resolution: AttachmentResolution,
): AttachmentFile {
  if (resolution.status === "ok") return resolution.file;
  throw attachmentFailureToError(resolution);
}

/** True when `error` is one of the attachment errors above, by shape. */
export function isAttachmentError(
  error: unknown,
): error is AttachmentUnavailableError | AttachmentStorageUnavailableError {
  if (
    error instanceof AttachmentUnavailableError ||
    error instanceof AttachmentStorageUnavailableError
  ) {
    return true;
  }
  if (!error || typeof error !== "object") return false;
  const shaped = error as {
    agentNativeStop?: unknown;
    actionContractError?: unknown;
    details?: { attachmentErrorCode?: unknown };
  };
  if (shaped.agentNativeStop !== true && shaped.actionContractError !== true) {
    return false;
  }
  return typeof shaped.details?.attachmentErrorCode === "string";
}
