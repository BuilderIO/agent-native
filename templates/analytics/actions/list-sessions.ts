import { z } from "zod";
import { defineAction } from "@agent-native/core";
import { desc } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "List recent Knowledge Q&A sessions.",
  schema: z.object({ limit: z.number().optional() }),
  http: { method: "GET" },
  run: async ({ limit = 20 }) => {
    const db = getDb();
    const rows = await db
      .select({
        id: schema.askSessions.id,
        question: schema.askSessions.question,
        status: schema.askSessions.status,
        createdAt: schema.askSessions.createdAt,
      })
      .from(schema.askSessions)
      .orderBy(desc(schema.askSessions.createdAt))
      .limit(limit);
    return { sessions: rows };
  },
});
