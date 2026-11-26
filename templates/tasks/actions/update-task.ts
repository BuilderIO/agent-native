import { defineAction } from "@agent-native/core/action";
import { EXPECTED_REVISION_DESCRIPTION } from "@agent-native/core/save-conflict/server";
import { z } from "zod";

import {
  fieldValueInputSchema,
  parseJsonArg,
} from "../server/custom-fields/schema.js";
import type { FieldValueInput } from "../server/custom-fields/values/store.js";
import { UserInputError } from "../server/errors.js";
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

export const updateTaskSchema = z.object({
  taskId: z.string().describe("Task id"),
  title: z.string().min(1).optional().describe("New task title"),
  done: z.boolean().optional().describe("Completion state"),
  fieldValues: fieldValuesSchema
    .optional()
    .describe("Custom field values to set or clear for this task"),
  expectedRevision: z
    .string()
    .optional()
    .describe(EXPECTED_REVISION_DESCRIPTION),
});

export default defineAction({
  description:
    "Update one task's title, completion state, and/or custom fields. Send the revision from list-tasks or your last update-task as expectedRevision. Returns the task with all its fields and its new revision. Use bulk-update-tasks to apply the same title or completion state to multiple tasks.",
  schema: updateTaskSchema,
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    if (
      args.title === undefined &&
      args.done === undefined &&
      args.fieldValues === undefined
    ) {
      throw new UserInputError(
        "Provide at least one of title, done, or fieldValues.",
      );
    }

    return updateTask({
      ownerEmail,
      id: args.taskId,
      title: args.title,
      done: args.done,
      fieldValues: args.fieldValues,
      expectedRevision: args.expectedRevision,
    });
  },
});
