import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Get a single composition by ID",
  parameters: {
    id: { type: "string", description: "Composition ID" },
  },
  http: { method: "GET" },
  run: async (args) => {
    if (!args.id) {
      return { error: "Composition id is required" };
    }

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.compositions)
      .where(eq(schema.compositions.id, args.id))
      .limit(1);

    if (rows.length > 0) {
      const row = rows[0];
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
