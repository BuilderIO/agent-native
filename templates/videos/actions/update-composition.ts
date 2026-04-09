import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Update an existing composition by ID",
  schema: z.object({
    id: z.string().optional().describe("Composition ID"),
    title: z.string().optional().describe("New title (optional)"),
    type: z.string().optional().describe("New type (optional)"),
    data: z
      .string()
      .optional()
      .describe("New composition data as JSON string (optional)"),
  }),
  run: async (args) => {
    if (!args.id) {
      return { error: "Composition id is required" };
    }

    const db = getDb();
    const now = new Date().toISOString();

    const updates: Record<string, any> = { updatedAt: now };
    if (args.title !== undefined) updates.title = args.title;
    if (args.type !== undefined) updates.type = args.type;
    if (args.data !== undefined) updates.data = args.data;

    const result = await db
      .update(schema.compositions)
      .set(updates)
      .where(eq(schema.compositions.id, args.id))
      .returning();

    if (result.length > 0) {
      const row = result[0];
      return {
        id: row.id,
        title: row.title,
        type: row.type,
        data: JSON.parse(row.data),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }

    return { error: "Composition not found" };
  },
});
