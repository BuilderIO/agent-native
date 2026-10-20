import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  resolveWorkflowReadScope,
  withReadFailures,
} from "../server/lib/workflow-read-actions.js";

export default defineAction({
  description:
    "Read one workflow run with its steps, for the run replay. Each step: node id, name and kind, status (running, succeeded, failed, skipped, needs_check), timing, the item count and first item ids on each output port, a small field map, the typed error, receipt keys, and the agent thread. Item ids and receipt keys are cut to 25 per port or step and flagged; a field map over 2 KB is omitted and flagged. A run with no steps comes back with an empty list; an id that is not in this factory is a workflow_run_not_found error.",
  schema: z.object({
    factoryId: factoryIdSchema,
    runId: z.string().trim().min(1).max(200),
  }),
  http: { method: "GET" },
  readOnly: true,
  // A run changes while the agent watches it, so an identical second read is
  // the point, not a repeat.
  dedupe: false,
  run: async ({ factoryId, runId }, context) =>
    withReadFailures(async () => {
      const { scope, models } = await resolveWorkflowReadScope(
        factoryId,
        context,
      );
      const detail = await models.getRun(scope, runId);
      if (!detail) {
        return fail(`Run "${runId}" was not found in this factory.`, {
          errorCode: "workflow_run_not_found",
          statusCode: 404,
          details: { runId },
        });
      }
      return detail;
    }),
});
