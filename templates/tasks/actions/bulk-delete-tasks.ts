import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { deleteTask, requireUserEmail } from "../server/tasks/store.js";

export default defineAction({
  description:
    "Delete multiple tasks permanently. Ask the user to confirm before calling.",
  schema: z.object({
    taskIds: z
      .array(z.string())
      .min(1)
      .describe("Task ids to delete"),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    for (const id of args.taskIds) {
      await deleteTask({ ownerEmail, id });
    }
    return { ok: true as const, deleted: args.taskIds.length };
  },
});
