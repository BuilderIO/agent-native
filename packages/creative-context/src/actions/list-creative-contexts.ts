import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getCreativeContext } from "../server/context.js";
import {
  getCreativeContextAppBinding,
  listCreativeContexts,
} from "../store/index.js";

export default defineAction({
  description: "List governed creative contexts available to the current user.",
  schema: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().optional(),
    includeArchived: z.boolean().default(false),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    const appId = getCreativeContext().connectorContext.appId;
    const [result, appBinding] = await Promise.all([
      listCreativeContexts(args),
      getCreativeContextAppBinding(appId),
    ]);
    return {
      ...result,
      appId,
      appDefaultContextId: appBinding?.id ?? null,
    };
  },
});
