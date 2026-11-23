import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { notebookThreadMatches } from "../server/lib/notebook-tool-context.js";
import { notebookExecution } from "../server/model/notebook-execution/service.js";
import {
  runAdmissionSchema,
  runRequestSchema,
} from "../shared/notebook-execution.js";
const selectedSqlRun = z
  .strictObject({
    request: runRequestSchema,
    selection: z.strictObject({
      from: z.int().nonnegative(),
      to: z.int().positive(),
    }),
  })
  .refine(
    ({ request, selection }) =>
      request.mode === "cell-only" && selection.to > selection.from,
  );
const [cellRun, runAll, runSection] = runRequestSchema.options;
const agentRunRequest = cellRun.extend({
  mode: z.enum([
    ...cellRun.shape.mode.options,
    runAll.shape.mode.value,
    runSection.shape.mode.value,
  ]),
  targetCellId: cellRun.shape.targetCellId
    .optional()
    .describe(
      "Required for every mode except run-all. For run-section, pass the Section header cell ID.",
    ),
  staleValues: cellRun.shape.staleValues
    .optional()
    .describe("Required for every mode except run-all."),
  restart: runAll.shape.restart.optional().describe("Required for run-all."),
});

export default defineAction({
  description:
    "Plan and queue a run from an accepted or thread notebook snapshot. Read-only SELECTs needed for the question are already authorized: run them without asking permission. Use run-section for a Section's runnable descendants and their prerequisites. A saved SQL selection runs without replacing the saved cell output. Retry with the original request ID and input to recover admission.",
  schema: z.union([runRequestSchema, selectedSqlRun]),
  agentInputSchema: z.union([
    agentRunRequest,
    selectedSqlRun.safeExtend({
      request: cellRun.extend({ mode: z.literal("cell-only") }),
    }),
  ]),
  outputSchema: runAdmissionSchema,
  retrySafe: true,
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  run: async (input, context) => {
    const { namespace } = ("request" in input ? input.request : input).snapshot;
    if (
      namespace.kind === "thread" &&
      !notebookThreadMatches(context, namespace.threadId)
    )
      return { status: "denied", reason: "access_denied" } as const;
    const execution = await notebookExecution(context?.caller ?? "unknown");
    const receipt = await start();
    if (
      receipt.status === "admitted" &&
      (context?.requestHeaders || context?.runId)
    )
      execution.wake(receipt.runId);
    return receipt;

    function start() {
      if ("request" in input) {
        const { request, ...entry } = input;
        return execution.start(request, entry);
      }
      return execution.start(input);
    }
  },
});
