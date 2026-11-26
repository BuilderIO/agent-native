import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  listRecipes,
  recipeSchema,
  personalErrors,
} from "../server/lib/personal-intelligence.js";

export default defineAction({
  description: "List your private reusable source-scoped work recipes.",
  schema: z.object({}),
  outputSchema: z.object({ recipes: z.array(recipeSchema) }),
  errors: personalErrors,
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  run: async () => listRecipes(),
});
