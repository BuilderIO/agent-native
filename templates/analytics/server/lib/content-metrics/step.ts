import type { ContentCollectionStepId } from "./config.js";
import type {
  ContentCollection,
  ContentItemInput,
  ContentRunFailure,
  ContentRunOutcome,
  ContentSnapshotInput,
} from "./store.js";

export type ContentStepResult = {
  items?: ContentItemInput[];
  snapshots?: ContentSnapshotInput[];
  outcome: ContentRunOutcome;
};

export type ContentStepContext = {
  collection: ContentCollection;
  signal?: AbortSignal;
  now: Date;
};

export type ContentStep = {
  id: ContentCollectionStepId;
  run(context: ContentStepContext): Promise<ContentStepResult>;
};

/**
 * A step's typed stop. `not_configured` and `cost_limited` are expected
 * states the view names as such; anything else thrown is a failed run.
 */
export class ContentStepStop extends Error {
  readonly failure: ContentRunFailure;

  constructor(failure: ContentRunFailure) {
    super(failure.errorMessage);
    this.name = "ContentStepStop";
    this.failure = failure;
  }
}

/**
 * Typed action errors for a missing connection (412/424) mean the step is
 * not set up yet. Everything else is a failure with its message kept.
 */
export function contentRunFailureFromError(error: unknown): ContentRunFailure {
  if (error instanceof ContentStepStop) return error.failure;
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  const errorCode = (error as { errorCode?: unknown } | null)?.errorCode;
  if (statusCode === 412 || statusCode === 424) {
    return {
      status: "not_configured",
      errorCode: typeof errorCode === "string" ? errorCode : "not_configured",
      errorMessage: message,
    };
  }
  return {
    status: "failed",
    errorCode: typeof errorCode === "string" ? errorCode : "step_failed",
    errorMessage: message,
  };
}
