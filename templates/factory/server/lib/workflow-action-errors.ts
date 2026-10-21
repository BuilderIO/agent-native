/**
 * Failures of the actions a workflow calls.
 *
 * The engine decides what to do next from two facts: whether the provider may
 * already have acted (`sideEffect`) and whether trying again could help
 * (`retryable`). A tool result reaches the engine as a string that keeps only
 * the message and the `errorCode`, so a failure that may have taken effect
 * also ends its code in `_outcome_unknown`; read it with `isOutcomeUnknown`.
 * `retryable` has no such spelling in the code: the caller that opens a call
 * with `collectFailureFlags` gets each failure's own flag back, matched by code.
 *
 * The class carries the marker core's `isActionContractError` reads, so the
 * action route treats it as a typed, user-facing failure. It is built here
 * rather than with `fail()` so server code can throw it without a runtime
 * import of `@agent-native/core/action`.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type WorkflowSideEffect = "none" | "maybe";

const OUTCOME_UNKNOWN_SUFFIX = "_outcome_unknown";

interface WorkflowActionErrorOptions {
  message: string;
  errorCode: string;
  statusCode?: number;
  /** Defaults to `none` unless the code ends in `_outcome_unknown`. */
  sideEffect?: WorkflowSideEffect;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export class WorkflowActionError extends Error {
  readonly actionContractError = true as const;
  readonly errorCode: string;
  readonly statusCode: number;
  readonly sideEffect: WorkflowSideEffect;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(options: WorkflowActionErrorOptions) {
    const sideEffect =
      options.sideEffect ??
      (options.errorCode.endsWith(OUTCOME_UNKNOWN_SUFFIX) ? "maybe" : "none");
    if (
      (sideEffect === "maybe") !==
      options.errorCode.endsWith(OUTCOME_UNKNOWN_SUFFIX)
    ) {
      throw new TypeError(
        `A failure that may have taken effect ends its code in ${OUTCOME_UNKNOWN_SUFFIX}, and no other code does: ${options.errorCode}.`,
      );
    }
    super(
      sideEffect === "maybe"
        ? `${options.message} It may already have taken effect, so check before trying again.`
        : options.message,
    );
    this.name = "WorkflowActionError";
    this.errorCode = options.errorCode;
    this.statusCode = options.statusCode ?? 424;
    this.sideEffect = sideEffect;
    this.retryable = options.retryable ?? false;
    this.details = {
      ...options.details,
      sideEffect,
      retryable: this.retryable,
    };
  }
}

export function isWorkflowActionError(
  error: unknown,
): error is WorkflowActionError {
  return error instanceof WorkflowActionError;
}

export function isOutcomeUnknown(error: unknown): boolean {
  if (error instanceof WorkflowActionError) return error.sideEffect === "maybe";
  const code = (error as { errorCode?: unknown } | null)?.errorCode;
  return typeof code === "string" && code.endsWith(OUTCOME_UNKNOWN_SUFFIX);
}

/** What a thrown failure said about trying again, kept beside the text a tool result reduces it to. */
export interface FailureFlag {
  errorCode: string;
  retryable: boolean;
}

const failureFlags = new AsyncLocalStorage<FailureFlag[]>();

/** Runs `work` so every failure an action throws under it lands in `into`, in order. */
export function collectFailureFlags<T>(into: FailureFlag[], work: () => T): T {
  return failureFlags.run(into, work);
}

/** The flag of the last failure thrown with this code, or undefined when none carried one. */
export function failureFlagFor(
  flags: readonly FailureFlag[],
  errorCode: string,
): boolean | undefined {
  for (let index = flags.length - 1; index >= 0; index -= 1) {
    if (flags[index].errorCode === errorCode) return flags[index].retryable;
  }
  return undefined;
}

export function failWorkflowAction(options: WorkflowActionErrorOptions): never {
  const error = new WorkflowActionError(options);
  failureFlags
    .getStore()
    ?.push({ errorCode: error.errorCode, retryable: error.retryable });
  throw error;
}

/** What an agent reading a run's failed step does about a provider that is not connected. */
export function connectionAdvice(provider: string): string {
  return `To connect it, call request-workflow-connection with provider "${provider}".`;
}
