import { z } from "zod";
import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Get a Knowledge Q&A session by ID.",
  schema: z.object({ id: z.string() }),
  http: { method: "GET" },
  run: async ({ id }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.askSessions)
      .where(eq(schema.askSessions.id, id));
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      id: row.id,
      question: row.question,
      answer: row.answer ?? null,
      status: row.status,
      sources: JSON.parse(row.sourcesJson),
      createdAt: row.createdAt,
    };
  },
});
