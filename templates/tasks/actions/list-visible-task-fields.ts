import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireUserEmail } from "../server/custom-fields/store.js";
import { getTaskCardFieldIds } from "../server/user-config/store.js";

export const listVisibleTaskFieldsSchema = z.object({});

export default defineAction({
  description:
    "List custom field ids currently shown on task cards for the current user.",
  schema: listVisibleTaskFieldsSchema,
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    const fieldIds = await getTaskCardFieldIds({ ownerEmail });
    return { fieldIds };
  },
});
