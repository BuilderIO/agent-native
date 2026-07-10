import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import {
  deleteCustomField,
  requireUserEmail,
} from "../server/custom-fields/store.js";

export default defineAction({
  description:
    "Delete a custom field definition and all of its values on every task. Ask the user to confirm before calling.",
  schema: z.object({
    fieldId: z.string().describe("Custom field id"),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    return deleteCustomField({ ownerEmail, fieldId: args.fieldId });
  },
});
