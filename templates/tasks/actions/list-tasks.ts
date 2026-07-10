import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { attachFieldsToTasks } from "../server/custom-fields/task-fields.js";
import { listTasks, requireUserEmail } from "../server/tasks/store.js";
import { booleanQueryParam } from "./lib/boolean-query-param.js";

export default defineAction({
  description:
    "List tasks for the current user. By default returns incomplete tasks only.",
  schema: z.object({
    includeDone: booleanQueryParam(false).describe(
      "When true, include completed tasks in the result.",
    ),
    includeFields: booleanQueryParam(false).describe(
      "When true, include each task's custom field values.",
    ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    const tasks = await listTasks({
      ownerEmail,
      includeDone: args.includeDone,
    });
    if (args.includeFields) {
      return { tasks: await attachFieldsToTasks(ownerEmail, tasks) };
    }
    return { tasks };
  },
});
