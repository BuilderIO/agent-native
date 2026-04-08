import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { eq, desc } from "drizzle-orm";

export default defineAction({
  description: "List weight entries for a specific date",
  parameters: {
    date: {
      type: "string",
      description: "Date in YYYY-MM-DD format (defaults to today)",
    },
  },
  http: { method: "GET" },
  run: async (args) => {
    const today = new Date();
    const date =
      args.date ||
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    return await db()
      .select()
      .from(schema.weights)
      .where(eq(schema.weights.date, date))
      .orderBy(desc(schema.weights.created_at));
  },
});
