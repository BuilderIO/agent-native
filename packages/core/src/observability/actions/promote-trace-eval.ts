import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getRunById, getRunEventsSince } from "../../agent/run-store.js";
import { getThread } from "../../chat-threads/store.js";
import {
  promoteTraceToEval,
  promotedDatasetDescription,
  promotedDatasetIdempotencyKey,
  sanitizedPromotedDatasetFromDataset,
  promotedEvalSpecFromDataset,
  type PromoteTraceError,
  type PromotedEval,
  type PromotedEvalSpec,
} from "../../eval/from-trace.js";
import {
  findPromotedEvalDataset,
  getTraceSpansForRun,
  getTraceSummary,
  savePromotedEvalDataset,
} from "../store.js";
import type { EvalDataset } from "../types.js";

/** Cap on run events loaded for one promotion. One past this is a refusal. */
export const PROMOTE_RUN_EVENT_LIMIT = 10_000;

type PromoteLoadError = PromoteTraceError | "events_truncated";

const PROMOTE_ERROR_STATUS: Record<PromoteLoadError, number> = {
  not_found: 404,
  run_not_completed: 409,
  no_user_prompt: 400,
  no_signal: 400,
  events_truncated: 413,
  unsafe_reviewed_text: 400,
};

const PROMOTE_ERROR_MESSAGE: Record<PromoteLoadError, string> = {
  not_found: "Trace not found",
  run_not_completed:
    "Run is not completed; truncated or aborted traces cannot become CI evals",
  no_user_prompt:
    "Run has no user prompt in its thread or events to use as the eval prompt",
  no_signal:
    "Run has no successful tools and no mustContain needle, so promotion would emit an empty eval",
  unsafe_reviewed_text:
    "Reviewed eval text contains an unsupported term. Replace names or organization labels with placeholders and use generic analytics words.",
  events_truncated: `Run event history exceeds ${PROMOTE_RUN_EVENT_LIMIT} events; refusing to promote a truncated trace`,
};

export interface PromoteTraceEvalArgs {
  runId: string;
  reviewedPrompt?: string;
  reviewedHistory?: Array<{ role: "user" | "assistant"; text: string }>;
  mustContain?: string;
  datasetName?: string;
}

export interface PromoteTraceEvalResult {
  sourceRunId: string;
  dataset: PromotedEval["dataset"];
  eval: PromotedEvalSpec;
}

function refuse(error: PromoteLoadError): never {
  fail(PROMOTE_ERROR_MESSAGE[error], {
    errorCode: error,
    statusCode: PROMOTE_ERROR_STATUS[error],
    ...(error === "events_truncated"
      ? { details: { limit: PROMOTE_RUN_EVENT_LIMIT } }
      : {}),
  });
}

export interface LoadedTraceEvalPromotion {
  promotion: PromoteTraceEvalResult;
  /** True when this owner already has a dataset for the source run. */
  alreadyStored: boolean;
}

async function storedPromotion(
  runId: string,
  userId: string | null,
): Promise<PromoteTraceEvalResult | null> {
  const existing = await findPromotedEvalDataset({
    idempotencyKey: promotedDatasetIdempotencyKey(runId, userId),
    description: promotedDatasetDescription(runId),
    userId,
  });
  if (!existing) return null;
  const dataset = sanitizedPromotedDatasetFromDataset(existing, runId);
  if (!dataset) return null;
  const spec = promotedEvalSpecFromDataset(dataset, runId);
  if (!spec) return null;
  return {
    sourceRunId: runId,
    dataset,
    eval: spec,
  };
}

/**
 * Map a caller-scoped run to an eval dataset without inserting.
 * `alreadyStored` means a previous promotion was found. Callers that write a
 * fixture must finish that write before `persistPromotedEvalDataset`.
 * Does not write `*.eval.ts`.
 */
export async function loadTraceEvalPromotion(
  args: PromoteTraceEvalArgs,
  opts: { userId?: string } = {},
): Promise<LoadedTraceEvalPromotion> {
  const runId = args.runId.trim();
  if (!runId) refuse("not_found");

  const userId = opts.userId ?? null;
  const summary = await getTraceSummary(runId, {
    ...(opts.userId ? { userId: opts.userId } : {}),
  });
  if (opts.userId && !summary) {
    refuse("not_found");
  }

  const stored = await storedPromotion(runId, userId);
  if (stored) return { promotion: stored, alreadyStored: true };

  const [run, events, spans] = await Promise.all([
    getRunById(runId),
    getRunEventsSince(runId, 0, { limit: PROMOTE_RUN_EVENT_LIMIT + 1 }),
    getTraceSpansForRun(runId, {
      ...(opts.userId ? { userId: opts.userId } : {}),
    }),
  ]);
  if (events.length > PROMOTE_RUN_EVENT_LIMIT) refuse("events_truncated");

  const thread = run?.threadId ? await getThread(run.threadId) : null;
  const result = promoteTraceToEval({
    runId,
    run,
    events,
    spans,
    threadInput: thread?.threadData,
    options: {
      reviewedPrompt: args.reviewedPrompt,
      reviewedHistory: args.reviewedHistory,
      mustContain: args.mustContain,
      datasetName: args.datasetName,
      userId,
    },
  });
  if (!result.ok) refuse(result.error);

  return {
    promotion: {
      sourceRunId: result.value.sourceRunId,
      dataset: result.value.dataset,
      eval: result.value.spec,
    },
    alreadyStored: false,
  };
}

/** Persist a mapped promotion. Repeat calls return the existing row. */
export async function persistPromotedEvalDataset(
  dataset: EvalDataset,
): Promise<EvalDataset> {
  const runId = dataset.entries[0]?.context?.runId;
  if (typeof runId !== "string") {
    fail("Promoted eval dataset is missing its trace id", {
      errorCode: "invalid_promoted_eval_dataset",
      statusCode: 400,
    });
  }
  const safeInput = sanitizedPromotedDatasetFromDataset(dataset, runId);
  if (!safeInput) {
    fail("Promoted eval dataset failed the privacy contract", {
      errorCode: "invalid_promoted_eval_dataset",
      statusCode: 400,
    });
  }
  const saved = await savePromotedEvalDataset(safeInput);
  const safe = sanitizedPromotedDatasetFromDataset(saved, runId);
  if (!safe) {
    fail("Stored promoted eval dataset failed the privacy contract", {
      errorCode: "stored_promoted_eval_privacy_failure",
      statusCode: 500,
    });
  }
  return safe;
}

/**
 * Load a caller-scoped run and persist one EvalDataset. Shared by the
 * `promote-trace-eval` action and the observability HTTP route.
 * Does not write `*.eval.ts`. Idempotent per owner and source run.
 * Event history past {@link PROMOTE_RUN_EVENT_LIMIT} fails with
 * `events_truncated` instead of promoting a partial trace.
 */
export async function promoteTraceEvalFromStore(
  args: PromoteTraceEvalArgs,
  opts: { userId?: string } = {},
): Promise<PromoteTraceEvalResult> {
  const loaded = await loadTraceEvalPromotion(args, opts);
  if (loaded.alreadyStored) return loaded.promotion;
  return {
    ...loaded.promotion,
    dataset: await persistPromotedEvalDataset(loaded.promotion.dataset),
  };
}

/**
 * Turn a completed production agent run into a CI eval case (dataset row plus
 * defineEval JSON). Use after a failing or surprising trace. Does not write
 * *.eval.ts; use the eval CLI --write for that.
 *
 * Mounted through mergeCoreSharingActions. Grouped under `labs` rather than a
 * new `observability` frameworkTools member — that union is filtered at
 * thirteen agent-chat composition sites; a dedicated group is a follow-up.
 */
export default defineAction({
  description:
    "Promote a completed run into a privacy-safe CI eval dataset and JSON spec, using reviewer text only when it passes the generic-word and entity-placeholder allowlist.",
  schema: z.object({
    runId: z
      .string()
      .describe("Completed agent run id from the observability trace list."),
    mustContain: z
      .string()
      .max(500)
      .optional()
      .describe(
        "Optional caller-reviewed substring the replayed reply must contain. Adds a contains() scorer. Only approved generic analytics words and placeholders are accepted; names or unknown terms fail the promotion. Required when the run called no successful tools.",
      ),
    reviewedPrompt: z
      .string()
      .max(3_000)
      .optional()
      .describe(
        "Optional manually reviewed prompt using only approved generic analytics words and entity placeholders such as [person] or [organization]. Unknown terms fail the promotion; the production prompt is never copied automatically.",
      ),
    reviewedHistory: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          text: z.string().max(1_000),
        }),
      )
      .max(16)
      .optional()
      .describe(
        "Optional manually reviewed history using only approved generic analytics words and entity placeholders. Unknown terms fail the promotion; production history is never copied automatically.",
      ),
  }),
  http: { method: "POST" },
  readOnly: false,
  run: async ({ runId, reviewedPrompt, reviewedHistory, mustContain }, ctx) => {
    const userId = ctx?.userEmail;
    if (!userId) {
      fail("Sign in to promote a trace", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    return promoteTraceEvalFromStore(
      { runId, reviewedPrompt, reviewedHistory, mustContain },
      { userId },
    );
  },
});
