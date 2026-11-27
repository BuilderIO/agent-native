import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  searchKnowledgePage,
  serializeKnowledge,
} from "../server/lib/brain.js";

export default defineAction({
  description:
    "List recent Brain knowledge accessible to the current user. Use search-knowledge for text queries.",
  schema: z.object({
    topic: z.string().optional(),
    tag: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: "search",
  run: async (args) => {
    const { rows, scanLimited } = await searchKnowledgePage(args);
    return {
      count: rows.length,
      scanLimited,
      knowledge: rows.map(serializeKnowledge),
    };
  },
});
