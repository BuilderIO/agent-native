import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { bulkDeleteTasks, requireUserEmail } from "../server/tasks/store.js";
import { BULK_ID_LIMIT } from "../shared/bulk-limits.js";

export default defineAction({
  description:
    "Delete multiple tasks permanently. Ask the user to confirm before calling.",
  schema: z.object({
    taskIds: z
      .array(z.string())
      .min(1)
      .max(BULK_ID_LIMIT)
      .describe("Task ids to delete"),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    return bulkDeleteTasks({ ownerEmail, taskIds: args.taskIds });
  },
});
