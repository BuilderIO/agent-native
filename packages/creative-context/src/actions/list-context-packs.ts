import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listContextPacks } from "../store/index.js";

export default defineAction({
  description: "List accessible immutable creative context packs.",
  schema: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().optional(),
    includeArchived: z.boolean().default(false),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: listContextPacks,
});
