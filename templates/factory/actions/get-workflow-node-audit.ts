import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  nodeIdSchema,
  resolveWorkflowReadScope,
  withReadFailures,
  workflowIdSchema,
} from "../server/lib/workflow-read-actions.js";
import { READ_LIMITS } from "../server/workflow-host/read-models.js";
import { runModeSchema } from "../server/workflow/contract.js";

export default defineAction({
  description:
    "Audit one node: its last runs' steps (newest first) with status counts, failure rate, and p50 and p95 duration; the newest step's item counts per output port with a few sampled item ids, titles, and short summaries going in and out; error codes with the latest message and the recent item-level errors (each with its code); and the receipts the node produced (message links, record ids, pull requests). Pass runId to read that run's step and the graph version it ran on; pass mode to look at live, dry, or test steps only. A node that is not in the graph version is a workflow_node_not_found error, not an empty audit; a node that never ran comes back with no steps and a null failure rate.",
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: workflowIdSchema,
    nodeId: nodeIdSchema,
    runId: z.string().trim().min(1).max(200).optional(),
    mode: runModeSchema.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(READ_LIMITS.nodeAuditMax)
      .default(READ_LIMITS.nodeAuditDefault),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (input, context) =>
    withReadFailures(async () => {
      const { scope, models } = await resolveWorkflowReadScope(
        input.factoryId,
        context,
      );
      return models.getNodeAudit(scope, {
        workflowId: input.workflowId,
        nodeId: input.nodeId,
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        ...(input.mode === undefined ? {} : { mode: input.mode }),
        limit: input.limit,
      });
    }),
});
