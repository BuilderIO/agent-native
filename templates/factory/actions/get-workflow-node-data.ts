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

export default defineAction({
  description:
    "Read the item fields a node took in and put out in one run, for a node's Input and Output views: per port, up to portLimit items, each with title, text, url, author, occurredAt, thread, and extras as stored, secrets redacted, each item capped at 8 KB and the whole response at 64 KB (truncated flags say what was cut). side \"in\" reads the items on the node's incoming edges, from the upstream steps' output ports; side \"out\" reads the node's own step ports; omit side for both. Pass runId to read that run; otherwise the newest run with a step for the node is read, any mode. An id with no stored item row comes back as { itemId, synthetic: true } only. A node or run that is not in this workflow is a typed not-found error; a node that never ran comes back with run null and empty ports. Not included: lookup and action responses, AI answers, or anything a step did not store as an item. Use get-workflow-node-audit for counts, status, errors, and receipts.",
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: workflowIdSchema,
    nodeId: nodeIdSchema,
    runId: z.string().trim().min(1).max(200).optional(),
    side: z.enum(["in", "out"]).optional(),
    portLimit: z.coerce
      .number()
      .int()
      .min(1)
      .max(READ_LIMITS.nodeDataPortMax)
      .default(READ_LIMITS.nodeDataPortDefault),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (input, context) =>
    withReadFailures(async () => {
      const { scope, models } = await resolveWorkflowReadScope(
        input.factoryId,
        context,
      );
      return models.getNodeData(scope, {
        workflowId: input.workflowId,
        nodeId: input.nodeId,
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        ...(input.side === undefined ? {} : { side: input.side }),
        portLimit: input.portLimit,
      });
    }),
});
