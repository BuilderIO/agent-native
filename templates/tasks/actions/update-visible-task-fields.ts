import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { requireUserEmail } from "../server/custom-fields/store.js";
import { setTaskCardFieldIds } from "../server/user-config/store.js";
import { TASK_CARD_FIELD_LIMIT } from "../shared/visible-task-fields.js";

export default defineAction({
  description:
    "Replace the custom fields shown on task cards for the current user.",
  schema: z.object({
    fieldIds: z
      .array(z.string())
      .max(TASK_CARD_FIELD_LIMIT)
      .describe(
        `Field ids to show on task cards, top-to-bottom. Max ${TASK_CARD_FIELD_LIMIT}.`,
      ),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    const fieldIds = await setTaskCardFieldIds({
      ownerEmail,
      fieldIds: args.fieldIds,
    });
    return { fieldIds };
  },
});
