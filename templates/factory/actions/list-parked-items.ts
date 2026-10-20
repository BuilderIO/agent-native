import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  cursorSchema,
  nodeIdSchema,
  pageLimitSchema,
  resolveWorkflowReadScope,
  withReadFailures,
  workflowIdSchema,
} from "../server/lib/workflow-read-actions.js";

export default defineAction({
  description:
    "List the items parked at a Wait in one workflow, soonest due first, one page at a time. Each row: the item (title, source, status), the node it waits at, the wake kind (reply, time, condition), when it is due, when it is next checked, the thread it watches, its counters, and its lease. byNode gives, for every Wait with parked items, how many wait and when the next is due, for the canvas badge. Pass nodeId for one Wait's items. A row with nodeMissingFromGraph is waiting at a node that has since been deleted.",
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: workflowIdSchema,
    nodeId: nodeIdSchema.optional(),
    limit: pageLimitSchema,
    cursor: cursorSchema,
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (input, context) =>
    withReadFailures(async () => {
      const { scope, models } = await resolveWorkflowReadScope(
        input.factoryId,
        context,
      );
      return models.listParked(scope, {
        workflowId: input.workflowId,
        ...(input.nodeId === undefined ? {} : { nodeId: input.nodeId }),
        limit: input.limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      });
    }),
});
