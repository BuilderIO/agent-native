import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  listCustomFields,
  requireUserEmail,
} from "../server/custom-fields/store.js";

export default defineAction({
  description: "List custom field definitions for the current user.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    return listCustomFields({ ownerEmail });
  },
});
