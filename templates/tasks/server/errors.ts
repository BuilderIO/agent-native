/**
 * Errors whose `statusCode` the action layer surfaces to callers instead of
 * hiding behind a generic 500 (see packages/core action-routes: errors with a
 * numeric `statusCode < 500` are echoed with their message). Use these for
 * caller mistakes so the agent and UI get an actionable 4xx, not "Internal
 * server error". Genuine invariant failures should stay a plain Error (500).
 */

export class UserInputError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}

export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class AuthError extends Error {
  readonly statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
