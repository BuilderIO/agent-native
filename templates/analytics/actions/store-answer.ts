import { z } from "zod";
import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

const AdditionalSourceSchema = z.object({
  type: z.enum(["github", "dbt", "notion", "other"]),
  title: z.string(),
  url: z.string().optional(),
  repo: z.string().optional(),
  excerpt: z.string().optional(),
});

export default defineAction({
  description:
    "Store a synthesized answer and any additional sources from dbt MCP for a Knowledge Q&A session.",
  schema: z.object({
    sessionId: z.string(),
    answer: z.string().describe("Markdown answer with inline [1][2] citations"),
    additionalSources: z.array(AdditionalSourceSchema).optional(),
    status: z.enum(["done", "error"]).optional(),
  }),
  run: async ({ sessionId, answer, additionalSources, status }) => {
    const db = getDb();
    const rows = await db
      .select({ sourcesJson: schema.askSessions.sourcesJson })
      .from(schema.askSessions)
      .where(eq(schema.askSessions.id, sessionId));
    const existing = JSON.parse(rows[0]?.sourcesJson ?? "[]");
    const merged = [...existing, ...(additionalSources ?? [])];
    const now = new Date().toISOString();
    await db
      .update(schema.askSessions)
      .set({
        answer,
        sourcesJson: JSON.stringify(merged),
        status: status ?? "done",
        updatedAt: now,
      })
      .where(eq(schema.askSessions.id, sessionId));
    return { ok: true };
  },
});
