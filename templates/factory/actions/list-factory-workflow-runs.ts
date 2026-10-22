import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  cursorSchema,
  pageLimitSchema,
  resolveWorkflowReadScope,
  withReadFailures,
  workflowIdSchema,
} from "../server/lib/workflow-read-actions.js";
import { runModeSchema, runStatusSchema } from "../server/workflow/contract.js";

export default defineAction({
  description:
    "List workflow runs, newest first, one page at a time. Each row: id, workflow, graph version, mode (live, dry, test), status (running, succeeded, failed, paused), trigger kind (schedule, manual, dry_run, test) and who started it (startedBy: schedule, or an email), start and finish, item counts (taken, done, dismissed, needsManual, released, itemFailures, needsCheck, modelCalls), and the error code and message. A tick with nothing due writes no run, so it is not listed. Read one with get-factory-workflow-run.",
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: workflowIdSchema
      .optional()
      .describe("Only this workflow's runs."),
    status: runStatusSchema.optional(),
    mode: runModeSchema.optional(),
    limit: pageLimitSchema,
    cursor: cursorSchema,
  }),
  http: { method: "GET" },
  readOnly: true,
  // A run changes while the agent watches it, so an identical second read is
  // the point, not a repeat.
  dedupe: false,
  run: async (input, context) =>
    withReadFailures(async () => {
      const { scope, models } = await resolveWorkflowReadScope(
        input.factoryId,
        context,
      );
      const page = await models.listRuns(scope, {
        ...(input.workflowId === undefined
          ? {}
          : { workflowId: input.workflowId }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.mode === undefined ? {} : { mode: input.mode }),
        limit: input.limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      });
      return {
        runs: page.items,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      };
    }),
});
