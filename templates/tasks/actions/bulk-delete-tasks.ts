import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { bulkDeleteTasks, requireUserEmail } from "../server/tasks/store.js";

export default defineAction({
  description:
    "Delete multiple tasks permanently. Ask the user to confirm before calling.",
  schema: z.object({
    taskIds: z.array(z.string()).min(1).describe("Task ids to delete"),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    return bulkDeleteTasks({ ownerEmail, taskIds: args.taskIds });
  },
});
