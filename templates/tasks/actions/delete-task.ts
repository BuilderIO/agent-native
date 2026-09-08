import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { deleteTask, requireUserEmail } from "../server/tasks/store.js";

export default defineAction({
  description:
    "Delete one task permanently. Use bulk-delete-tasks for multiple tasks. Ask the user to confirm before calling.",
  schema: z.object({
    taskId: z.string().describe("Task id"),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    await deleteTask({ ownerEmail, id: args.taskId });
    return { ok: true as const };
  },
});
