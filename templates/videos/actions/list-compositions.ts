import { defineAction } from "@agent-native/core";
import { desc } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "List all compositions ordered by most recently updated",
  parameters: {},
  http: { method: "GET" },
  run: async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.compositions)
      .orderBy(desc(schema.compositions.updatedAt));

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      data: JSON.parse(row.data),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  },
});
