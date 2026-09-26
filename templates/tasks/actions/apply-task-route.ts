import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { UserInputError } from "../server/errors.js";
import {
  ensureQueueField,
  findQueueField,
  DEFAULT_QUEUES,
} from "../server/task-routing.js";
import {
  getTask,
  requireUserEmail,
  updateTask,
} from "../server/tasks/store.js";

export default defineAction({
  description:
    "Apply a reviewed queue suggestion to a task. Creates the default Queue field on first use; the queue name must match an available option.",
  schema: z.object({
    taskId: z.string().describe("Task id to route"),
    queueName: z.string().describe("Name of the accepted queue option"),
  }),
  run: async ({ taskId, queueName }, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    const task = await getTask({ ownerEmail, id: taskId });
    if (!task) throw new UserInputError("Task not found.");

    const existing = await findQueueField(ownerEmail);
    const available =
      existing?.config.options.map((option) => option.name) ?? DEFAULT_QUEUES;
    if (!available.includes(queueName)) {
      throw new UserInputError("Queue is no longer available.");
    }

    const field = existing ?? (await ensureQueueField(ownerEmail));
    const option = field.config.options.find(
      (candidate) => candidate.name === queueName,
    );
    if (!option) throw new UserInputError("Queue is no longer available.");

    return updateTask({
      ownerEmail,
      id: taskId,
      fieldValues: [{ fieldId: field.id, value: option.id }],
    });
  },
});
