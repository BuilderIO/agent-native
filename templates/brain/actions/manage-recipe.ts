import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  manageRecipe,
  personalErrors,
} from "../server/lib/personal-intelligence.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  description:
    "Save, edit, or delete a private reusable query or workflow scoped to accessible sources or a project. Recipes never grant source access.",
  schema: z.object({
    operation: z.enum(["save", "delete"]),
    id: z.string().optional(),
    expectedRevision: z.string().optional(),
    title: z.string().trim().min(1).max(120).optional(),
    prompt: z.string().trim().min(1).max(6000).optional(),
    sourceIds: z.array(z.string().min(1)).max(50).optional(),
    projectId: z.string().nullable().optional(),
  }),
  outputSchema: z.object({ id: z.string(), deleted: z.boolean() }),
  errors: personalErrors,
  mcpTool: true,
  run: async (args) => manageRecipe(args),
});
