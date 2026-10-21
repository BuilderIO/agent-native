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
import { READ_LIMITS } from "../server/workflow-host/read-models.js";

export default defineAction({
  description:
    "List the items workflows have taken, most recently active first, one page at a time: the Items tab. Each row: title, source, inbox status, where the item is (the node it is parked at with its wake time, or the node of its last event), attempts, why a person has to look (handed_off, attempts_exhausted, effect_needs_check), and its last event. Use needsYou for the items that need a person, parked for the ones waiting at a Wait, status for inbox statuses, source for slack, github, and so on, and search for a title or item id. Open one with get-item-journey.",
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: workflowIdSchema.optional(),
    status: z
      .array(z.string().trim().min(1).max(60))
      .max(20)
      .optional()
      .describe(
        "Inbox statuses to include, such as dismissed or needs_manual.",
      ),
    needsYou: z
      .boolean()
      .optional()
      .describe(
        "Only items a person has to look at: handed to a person, out of attempts, or holding a write that may have happened.",
      ),
    parked: z
      .boolean()
      .optional()
      .describe("True: only waiting items. False: only items not waiting."),
    source: z.string().trim().min(1).max(60).optional(),
    search: z.string().trim().max(READ_LIMITS.searchChars).optional(),
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
      const page = await models.listItems(scope, {
        ...(input.workflowId === undefined
          ? {}
          : { workflowId: input.workflowId }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.needsYou === undefined ? {} : { needsYou: input.needsYou }),
        ...(input.parked === undefined ? {} : { parked: input.parked }),
        ...(input.source === undefined ? {} : { source: input.source }),
        ...(input.search === undefined ? {} : { search: input.search }),
        limit: input.limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      });
      return {
        items: page.items,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      };
    }),
});
