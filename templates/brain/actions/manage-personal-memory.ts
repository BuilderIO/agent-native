import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  managePersonalMemory,
  personalErrors,
} from "../server/lib/personal-intelligence.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  description:
    "Save, edit, or delete an explicitly supplied private work preference. Do not use for facts derived from source evidence; use write-intelligence for those.",
  schema: z.object({
    operation: z.enum(["save", "delete"]),
    id: z.string().optional(),
    expectedRevision: z.string().optional(),
    content: z.string().trim().min(1).max(2000).optional(),
  }),
  outputSchema: z.object({ id: z.string(), deleted: z.boolean() }),
  errors: personalErrors,
  mcpTool: true,
  run: async (args) => managePersonalMemory(args),
});
