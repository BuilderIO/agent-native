import { defineAction } from "@agent-native/core";
import { desc } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { z } from "zod";

export default defineAction({
  description: "List all decks from the database with metadata.",
  schema: z.object({
    compact: z
      .enum(["true", "false"])
      .optional()
      .describe("Set to 'true' for compact output"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.decks)
      .orderBy(desc(schema.decks.updatedAt));

    if (rows.length === 0) {
      return { count: 0, decks: [] };
    }

    const items = rows.map((row) => {
      const data = JSON.parse(row.data);
      const slides = data?.slides;
      if (args.compact === "true") {
        return {
          id: row.id,
          title: row.title,
          slideCount: slides?.length ?? 0,
        };
      }
      return {
        id: row.id,
        title: row.title,
        slideCount: slides?.length ?? 0,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    return { count: items.length, decks: items };
  },
});
