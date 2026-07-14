import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  fieldValueInputSchema,
  parseJsonArg,
} from "../server/custom-fields/schema.js";
import { listTaskFieldValues } from "../server/custom-fields/task-fields.js";
import type { FieldValueInput } from "../server/custom-fields/values/store.js";
import { updateTask, requireUserEmail } from "../server/tasks/store.js";

type FieldValuePatch = {
  fieldId: string;
  value: FieldValueInput;
};

const fieldValuePatchSchema: z.ZodType<FieldValuePatch> = z.object({
  fieldId: z.string().describe("Custom field id"),
  value: fieldValueInputSchema.describe("Custom field value; null clears it"),
});

const fieldValuesSchema: z.ZodType<FieldValuePatch[]> = z.preprocess(
  parseJsonArg,
  z.array(fieldValuePatchSchema),
);

export default defineAction({
  description: "Update a task title, completion state, and/or custom fields.",
  schema: z.object({
    taskId: z.string().describe("Task id"),
    title: z.string().min(1).optional().describe("New task title"),
    done: z.boolean().optional().describe("Completion state"),
    fieldValues: fieldValuesSchema
      .optional()
      .describe("Custom field values to set or clear for this task"),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    if (
      args.title === undefined &&
      args.done === undefined &&
      args.fieldValues === undefined
    ) {
      throw new Error("Provide at least one of title, done, or fieldValues.");
    }

    const task = await updateTask({
      ownerEmail,
      id: args.taskId,
      title: args.title,
      done: args.done,
      fieldValues: args.fieldValues,
    });

    if (args.fieldValues !== undefined) {
      const fields = await listTaskFieldValues({
        ownerEmail,
        taskId: args.taskId,
      });
      return { ...task, fields };
    }

    return task;
  },
});
