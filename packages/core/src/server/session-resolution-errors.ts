import { isTransientDatabaseError } from "../db/errors.js";
import { ForbiddenError } from "../sharing/errors.js";
import { PublicServerError } from "./public-server-error.js";

export class SessionResolutionUnavailableError extends PublicServerError {
  readonly statusCode = 503;
  readonly headers = { "Retry-After": "5" };

  constructor(options?: ErrorOptions) {
    super("Session unavailable", options);
    this.name = "SessionResolutionUnavailableError";
  }
}

export class SessionResolutionLookupError extends PublicServerError {
  readonly statusCode = 500;

  constructor(cause: unknown) {
    super("Internal server error", { cause });
    this.name = "SessionResolutionLookupError";
  }
}

export function sessionResolutionFailure(cause: unknown): Error {
  if (
    cause instanceof ForbiddenError ||
    cause instanceof SessionResolutionUnavailableError ||
    cause instanceof SessionResolutionLookupError
  )
    return cause;
  return isTransientDatabaseError(cause)
    ? new SessionResolutionUnavailableError({ cause })
    : new SessionResolutionLookupError(cause);
}
