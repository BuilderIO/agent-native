import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listContextSources } from "../store/index.js";

export default defineAction({
  description: "List creative context sources visible to the current user.",
  schema: z.object({
    status: z.enum(["active", "paused", "archived", "error"]).optional(),
    healthStatus: z
      .enum(["healthy", "stale", "error", "needs_setup", "paused"])
      .optional(),
    kind: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: listContextSources,
});
