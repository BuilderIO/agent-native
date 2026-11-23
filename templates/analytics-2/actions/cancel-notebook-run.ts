import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { notebookThreadMatches } from "../server/lib/notebook-tool-context.js";
import { notebookExecution } from "../server/model/notebook-execution/service.js";
import {
  runCancellationSchema,
  runIdSchema,
} from "../shared/notebook-execution.js";
import { notebookCellIdSchema } from "../shared/notebook-snapshot-contract.js";

export default defineAction({
  description:
    "Request cancellation of a notebook run or one cell in the run. Read run events to confirm the outcome.",
  schema: z.strictObject({
    runId: runIdSchema,
    cellId: notebookCellIdSchema.optional(),
    threadId: z.string().min(1).max(128).optional(),
  }),
  outputSchema: runCancellationSchema,
  retrySafe: true,
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ runId, cellId, threadId }, context) => {
    if (!notebookThreadMatches(context, threadId))
      return { status: "denied", reason: "access_denied" } as const;
    const execution = await notebookExecution(context?.caller ?? "unknown");
    const receipt = await execution.cancel(runId, cellId, threadId);
    if (
      receipt.status === "pending" &&
      (context?.requestHeaders || context?.runId)
    )
      execution.wake(runId);
    return receipt;
  },
});
