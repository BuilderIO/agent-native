import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  prepareRecipe,
  personalErrors,
  recipeSchema,
} from "../server/lib/personal-intelligence.js";

export default defineAction({
  description:
    "Read a saved recipe after rechecking current access to its project and sources. Run its prompt through agent chat; use the existing automation actions for a schedule.",
  schema: z.object({ id: z.string().min(1) }),
  outputSchema: z.object({
    recipe: recipeSchema,
    scope: z.object({
      sourceIds: z.array(z.string()).nullable(),
      projectId: z.string().nullable(),
    }),
  }),
  errors: personalErrors,
  readOnly: true,
  mcpTool: true,
  run: async ({ id }) => prepareRecipe(id),
});
