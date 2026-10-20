import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  cursorSchema,
  itemIdSchema,
  resolveWorkflowReadScope,
  withReadFailures,
  workflowIdSchema,
} from "../server/lib/workflow-read-actions.js";
import { READ_LIMITS } from "../server/workflow-host/read-models.js";

export default defineAction({
  description:
    "Read one item's whole path through one workflow: the item (title, source, status), its live state (where it is parked and until when, its lease, attempts, why a person has to look), its events oldest first (the newest page of them; olderCursor loads earlier ones; an ended event carries its outcome and an error event its code), the steps those events touched, the receipts with external references and urls, and the path as node ids with visit counts so the canvas can light the route. Dry-run events are marked with their mode. An item the workflow never touched is a workflow_item_not_found error.",
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: workflowIdSchema,
    itemId: itemIdSchema,
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(READ_LIMITS.journeyEventsMax)
      .default(READ_LIMITS.journeyEventsDefault),
    cursor: cursorSchema.describe(
      "The olderCursor of the previous response, to load earlier events.",
    ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (input, context) =>
    withReadFailures(async () => {
      const { scope, models } = await resolveWorkflowReadScope(
        input.factoryId,
        context,
      );
      return models.getItemJourney(scope, {
        workflowId: input.workflowId,
        itemId: input.itemId,
        limit: input.limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      });
    }),
});
