export class ContextXrayActionError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "ContextXrayActionError";
  }
}

export function contextXrayAuthError(): ContextXrayActionError {
  return new ContextXrayActionError(
    "Context X-Ray requires a signed-in user.",
    401,
  );
}

export function contextXrayThreadNotFoundError(): ContextXrayActionError {
  return new ContextXrayActionError("Thread not found.", 404);
}
