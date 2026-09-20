import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getRunById, getRunEventsSince } from "../../agent/run-store.js";
import {
  promoteTraceToEval,
  type PromoteTraceError,
  type PromotedEval,
  type PromotedEvalSpec,
} from "../../eval/from-trace.js";
import {
  getTraceSpansForRun,
  getTraceSummary,
  insertEvalDataset,
} from "../store.js";

const PROMOTE_ERROR_STATUS: Record<PromoteTraceError, number> = {
  not_found: 404,
  run_not_completed: 409,
  no_user_prompt: 400,
  no_signal: 400,
};

const PROMOTE_ERROR_MESSAGE: Record<PromoteTraceError, string> = {
  not_found: "Trace not found",
  run_not_completed:
    "Run is not completed; truncated or aborted traces cannot become CI evals",
  no_user_prompt: "Run has no user-message event to use as the eval prompt",
  no_signal:
    "Run has no successful tools and no mustContain needle, so promotion would emit an empty eval",
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

function refuse(error: PromoteTraceError): never {
  fail(PROMOTE_ERROR_MESSAGE[error], {
    errorCode: error,
    statusCode: PROMOTE_ERROR_STATUS[error],
  });
}

/**
 * Load a caller-scoped run and persist one EvalDataset. Shared by the
 * `promote-trace-eval` action, the observability HTTP route, and the eval CLI.
 * Does not write `*.eval.ts`.
 */
export async function promoteTraceEvalFromStore(
  args: PromoteTraceEvalArgs,
  opts: { userId?: string } = {},
): Promise<PromoteTraceEvalResult> {
  const runId = args.runId.trim();
  if (!runId) refuse("not_found");

  const summary = await getTraceSummary(runId, {
    ...(opts.userId ? { userId: opts.userId } : {}),
  });
  if (opts.userId && !summary) {
    refuse("not_found");
  }

  const [run, events, spans] = await Promise.all([
    getRunById(runId),
    getRunEventsSince(runId, 0),
    getTraceSpansForRun(runId, {
      ...(opts.userId ? { userId: opts.userId } : {}),
    }),
  ]);

  const result = promoteTraceToEval({
    runId,
    run,
    events,
    spans,
    options: {
      mustContain: args.mustContain,
      datasetName: args.datasetName,
      userId: opts.userId ?? null,
    },
  });
  if (!result.ok) refuse(result.error);

  await insertEvalDataset(result.value.dataset);
  return {
    sourceRunId: result.value.sourceRunId,
    dataset: result.value.dataset,
    eval: result.value.spec,
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
