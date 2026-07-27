import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import {
  createTask,
  requireUserEmail,
  type Task,
} from "../server/tasks/store.js";

export default defineAction({
  description:
    "Create an incomplete task directly on the task list. Use create-inbox-item for a quick capture to triage later.",
  schema: z.object({
    title: z.string().min(1).describe("Task title"),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    const task = await createTask({ ownerEmail, title: args.title });
    return task;
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const task = result as Task;
    if (!task.id || !task.title) return null;
    return {
      url: buildDeepLink({
        view: "tasks",
        params: { taskId: task.id },
      }),
      label: task.title,
    };
  },
});
