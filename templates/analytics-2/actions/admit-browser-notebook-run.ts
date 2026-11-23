import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { usesBrowserNotebookKernel } from "../server/execution/kernel-client.js";
import {
  currentExecutionActor,
  notebookRunStore,
} from "../server/model/notebook-execution/service.js";
import {
  attemptIdentitySchema,
  executionSnapshotSchema,
  runAdmissionSchema,
  runRequestSchema,
} from "../shared/notebook-execution.js";

const [cellRun] = runRequestSchema.options;
const [, ...refusals] = runAdmissionSchema.options;
const admitted = attemptIdentitySchema
  .pick({
    runId: true,
    attemptId: true,
    outputGeneration: true,
  })
  .extend({ status: z.literal("admitted") });

export default defineAction({
  description: "Reserve a draft cell attempt for the browser notebook kernel.",
  schema: z.strictObject({
    snapshot: executionSnapshotSchema,
    requestId: z.string().min(1).max(128),
    cellId: cellRun.shape.targetCellId,
  }),
  outputSchema: z.discriminatedUnion("status", [admitted, ...refusals]),
  http: { method: "POST" },
  uiOnly: true,
  retrySafe: true,
  run: async ({ snapshot, requestId, cellId }, context) => {
    const rejected = {
      status: "rejected",
      reason: "unsupported_request",
    } as const;
    if (!usesBrowserNotebookKernel()) return rejected;
    const actor = await currentExecutionActor(context?.caller ?? "frontend");
    const run = await notebookRunStore.admit(
      actor,
      cellRun.parse({
        snapshot,
        requestId,
        mode: "cell-only",
        targetCellId: cellId,
        staleValues: "allow-compatible",
        cache: "bypass",
      }),
      { executor: "browser" },
    );
    if (run.status !== "admitted") return run;
    const receipt = run.attempts.at(0);
    if (!receipt) return rejected;
    const { runId, attemptId, outputGeneration } = receipt.attempt;
    return { status: "admitted", runId, attemptId, outputGeneration } as const;
  },
});
