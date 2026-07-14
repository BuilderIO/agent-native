import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireUserEmail, bulkUpdateTasks } from "../server/tasks/store.js";
import { BULK_ID_LIMIT } from "../shared/bulk-limits.js";

export default defineAction({
  description:
    "Update multiple tasks with the same title and/or completion patch.",
  schema: z.object({
    taskIds: z
      .array(z.string())
      .min(1)
      .max(BULK_ID_LIMIT)
      .describe("Task ids to update"),
    title: z.string().min(1).optional().describe("New title for every task"),
    done: z.boolean().optional().describe("Completion state for every task"),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    if (args.title === undefined && args.done === undefined) {
      throw new Error("Provide at least one of title or done.");
    }

    const tasks = await bulkUpdateTasks({
      ownerEmail,
      taskIds: args.taskIds,
      title: args.title,
      done: args.done,
    });

    return { tasks };
  },
});
