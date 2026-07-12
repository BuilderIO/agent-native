import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  readBrainAgentGuidance,
  searchKnowledgeRows,
  serializeKnowledge,
} from "../server/lib/brain.js";

export default defineAction({
  description:
    "Search Brain knowledge with SQL text matching over title, summary, and body. No vector DB is used.",
  schema: z.object({
    query: z.string().min(1).optional(),
    topic: z.string().optional(),
    tag: z.string().optional(),
    status: z
      .enum(["draft", "published", "redacted", "archived", "all"])
      .optional(),
    includeDrafts: z.coerce.boolean().default(false),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: false,
    isConsequential: false,
  },
  run: async (args) => {
    const { guidance } = await readBrainAgentGuidance();
    const rows = await searchKnowledgeRows(args);
    return {
      count: rows.length,
      policy: guidance.retrieval,
      responseGuidance: guidance.response,
      knowledge: rows.map(serializeKnowledge),
    };
  },
});
