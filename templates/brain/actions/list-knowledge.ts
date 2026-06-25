import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  searchKnowledgeRows,
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
  run: async (args) => {
    const rows = await searchKnowledgeRows(args);
    return { count: rows.length, knowledge: rows.map(serializeKnowledge) };
  },
});
