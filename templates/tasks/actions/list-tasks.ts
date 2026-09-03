import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { attachFieldsToTasks } from "../server/custom-fields/task-fields.js";
import {
  hasCompletedTasks,
  listTasks,
  requireUserEmail,
} from "../server/tasks/store.js";
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
    const hasCompleted =
      args.includeDone === true
        ? undefined
        : tasks.length === 0
          ? await hasCompletedTasks({ ownerEmail })
          : false;
    if (args.includeFields) {
      return {
        tasks: await attachFieldsToTasks(ownerEmail, tasks),
        ...(hasCompleted !== undefined
          ? { hasCompletedTasks: hasCompleted }
          : {}),
      };
    }
    return {
      tasks,
      ...(hasCompleted !== undefined
        ? { hasCompletedTasks: hasCompleted }
        : {}),
    };
  },
});
