import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { reorderTasks, requireUserEmail } from "../server/tasks/store.js";
import { booleanQueryParam } from "./lib/boolean-query-param.js";

export default defineAction({
  description:
    "Reorder the visible task list by passing task ids top-to-bottom. Use the same includeDone flag as the current list filter.",
  schema: z.object({
    taskIds: z
      .array(z.string())
      .min(1)
      .describe("Task ids in the desired order from top to bottom."),
    includeDone: booleanQueryParam(false).describe(
      "When true, reorder the show-all list including completed tasks.",
    ),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    return reorderTasks({
      ownerEmail,
      taskIds: args.taskIds,
      includeDone: args.includeDone,
    });
  },
});
