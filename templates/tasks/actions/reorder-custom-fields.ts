import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import {
  reorderCustomFields,
  requireUserEmail,
} from "../server/custom-fields/store.js";

export default defineAction({
  description:
    "Reorder custom field definitions by passing field ids top-to-bottom.",
  schema: z.object({
    fieldIds: z
      .array(z.string())
      .min(1)
      .describe("Field ids in the desired order from top to bottom."),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    return reorderCustomFields({
      ownerEmail,
      fieldIds: args.fieldIds,
    });
  },
});
