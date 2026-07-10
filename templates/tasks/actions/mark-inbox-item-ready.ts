import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { markInboxItemReady, requireUserEmail } from "../server/inbox/store.js";
import type { Task } from "../server/tasks/store.js";

export default defineAction({
  description:
    "Mark an inbox item ready: promotes the inbox item to an incomplete task (same id).",
  schema: z.object({
    inboxItemId: z.string().describe("Inbox item id"),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    return markInboxItemReady({ ownerEmail, id: args.inboxItemId });
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const payload = result as { task?: Task };
    const task = payload.task;
    if (!task?.id || !task.title) return null;
    return {
      url: buildDeepLink({
        view: "tasks",
        params: { taskId: task.id },
      }),
      label: task.title,
    };
  },
});
