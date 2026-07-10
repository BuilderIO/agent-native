import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { updateCustomFieldConfigActionSchema } from "../server/custom-fields/schema.js";
import {
  requireUserEmail,
  updateCustomField,
} from "../server/custom-fields/store.js";

export default defineAction({
  description:
    "Rename or reconfigure a custom field definition. The field type cannot change.",
  schema: z.object({
    fieldId: z.string().describe("Custom field id"),
    title: z.string().min(1).optional().describe("New field title"),
    config: updateCustomFieldConfigActionSchema
      .optional()
      .describe("Type-compatible field configuration"),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    if (args.title === undefined && args.config === undefined) {
      throw new Error("Provide title or config.");
    }
    return updateCustomField({
      ownerEmail,
      fieldId: args.fieldId,
      title: args.title,
      config: args.config,
    });
  },
});
