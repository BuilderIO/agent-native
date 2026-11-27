export interface ActionFailOptions {
  /** HTTP status code (preferred, matches `@agent-native/core`). Defaults to 400. */
  statusCode?: number;
  /** Alias for `statusCode`. */
  status?: number;
  /** Machine-readable error code surfaced to UI callers, MCP clients, and agents. */
  errorCode?: string;
  /** Bounded structured context for callers/agents (ids, field names, limits). */
  details?: Record<string, unknown>;
}

const ACTION_ERROR_BRAND = Symbol.for("agent-native.actions.ActionError");
const POST_COMMIT_ERROR_BRAND = Symbol.for(
  "agent-native.actions.ActionPostCommitError",
);

export class ActionError extends Error {
  readonly [ACTION_ERROR_BRAND] = true;
  readonly statusCode: number;
  readonly errorCode: string;
  readonly details: Record<string, unknown> | undefined;
  readonly committed: boolean;

  constructor(
    message: string,
    options: ActionFailOptions & { committed?: boolean } = {},
  ) {
    super(message);
    this.name = "ActionError";
    this.statusCode = options.statusCode ?? options.status ?? 400;
    this.errorCode = options.errorCode ?? "action_failed";
    this.details = options.details;
    this.committed = options.committed ?? false;
  }
}

/**
 * Raised when an action's `run()` already completed (so side effects may have
 * committed), but a post-run step such as `outputSchema` validation or
 * `onAfterMutate` failed. Callers must not blindly retry writes on this error.
 */
export class ActionPostCommitError extends ActionError {
  readonly [POST_COMMIT_ERROR_BRAND] = true;
  override readonly cause: unknown;

  constructor(
    message: string,
    cause?: unknown,
    details?: Record<string, unknown>,
  ) {
    super(message, {
      statusCode: 500,
      errorCode: "post_commit_error",
      committed: true,
      ...(details ? { details } : {}),
    });
    this.name = "ActionPostCommitError";
    this.cause = cause;
  }
}

export function isActionError(value: unknown): value is ActionError {
  return (
    value instanceof ActionError ||
    (typeof value === "object" && value !== null && ACTION_ERROR_BRAND in value)
  );
}

export function isActionPostCommitError(
  value: unknown,
): value is ActionPostCommitError {
  return (
    value instanceof ActionPostCommitError ||
    (typeof value === "object" &&
      value !== null &&
      POST_COMMIT_ERROR_BRAND in value)
  );
}

/**
 * Throw a structured, caller-readable error from an action.
 * Compatible with `@agent-native/core`'s `fail()`.
 */
export function fail(message: string, options: ActionFailOptions = {}): never {
  throw new ActionError(message, options);
}

export interface ActionErrorSet<TCode extends string> {
  readonly codes: readonly TCode[];
  fail: (
    message: string,
    code: TCode,
    options?: Omit<ActionFailOptions, "errorCode">,
  ) => never;
}

/**
 * Declare a closed set of error codes for an action, matching `@agent-native/core`'s
 * `defineActionErrors("not_found", "already_paid")`.
 */
export function defineActionErrors<
  const TCodes extends readonly [string, ...string[]],
>(...codes: TCodes): ActionErrorSet<TCodes[number]> {
  const allowed = new Set<string>(codes);
  return {
    codes,
    fail(message, code, options = {}) {
      if (!allowed.has(code)) {
        throw new Error(
          `Unknown action errorCode "${code}". Declared codes: ${codes.join(", ")}`,
        );
      }
      throw new ActionError(message, { ...options, errorCode: code });
    },
  };
}

export function serializeActionErrorBody(error: unknown): {
  statusCode: number;
  body: {
    error: string;
    errorCode: string;
    committed?: true;
    details?: Record<string, unknown>;
  };
} {
  if (isActionPostCommitError(error)) {
    return {
      statusCode: 500,
      body: {
        error: "Action completed but post-execution processing failed.",
        errorCode: error.errorCode,
        committed: true,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }
  if (isActionError(error)) {
    const safeMessage =
      error.statusCode >= 500 ? "Internal action error." : error.message;
    return {
      statusCode: error.statusCode,
      body: {
        error: safeMessage,
        errorCode: error.errorCode,
        ...(error.committed ? { committed: true as const } : {}),
        ...(error.statusCode < 500 && error.details
          ? { details: error.details }
          : {}),
      },
    };
  }
  return {
    statusCode: 500,
    body: {
      error: "Internal action error.",
      errorCode: "internal_error",
    },
  };
}
