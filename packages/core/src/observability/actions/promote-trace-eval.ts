import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getRunById, getRunEventsSince } from "../../agent/run-store.js";
import { getThread } from "../../chat-threads/store.js";
import {
  promoteTraceToEval,
  promotedDatasetDescription,
  promotedDatasetIdempotencyKey,
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
};

const PROMOTE_ERROR_MESSAGE: Record<PromoteLoadError, string> = {
  not_found: "Trace not found",
  run_not_completed:
    "Run is not completed; truncated or aborted traces cannot become CI evals",
  no_user_prompt:
    "Run has no user prompt in its thread or events to use as the eval prompt",
  no_signal:
    "Run has no successful tools and no mustContain needle, so promotion would emit an empty eval",
  events_truncated: `Run event history exceeds ${PROMOTE_RUN_EVENT_LIMIT} events; refusing to promote a truncated trace`,
};

export interface PromoteTraceEvalArgs {
  runId: string;
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
  const spec = promotedEvalSpecFromDataset(existing, runId);
  if (!spec) return null;
  return {
    sourceRunId: runId,
    dataset: existing,
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
  return savePromotedEvalDataset(dataset);
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
    "Turn a completed production agent run into a CI eval case (dataset row plus defineEval JSON). Use after a failing or surprising trace. Does not write *.eval.ts; use the eval CLI --write for that.",
  schema: z.object({
    runId: z
      .string()
      .describe("Completed agent run id from the observability trace list."),
    mustContain: z
      .string()
      .optional()
      .describe(
        "Optional substring the agent's reply must contain. Adds a contains() scorer; required when the run called no successful tools.",
      ),
    datasetName: z
      .string()
      .optional()
      .describe("Optional EvalDataset name. Defaults to from-trace:<runId>."),
  }),
  http: { method: "POST" },
  readOnly: false,
  run: async ({ runId, mustContain, datasetName }, ctx) => {
    const userId = ctx?.userEmail;
    if (!userId) {
      fail("Sign in to promote a trace", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    return promoteTraceEvalFromStore(
      { runId, mustContain, datasetName },
      { userId },
    );
  },
});
