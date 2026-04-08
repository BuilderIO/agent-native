import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { eq, desc } from "drizzle-orm";

export default defineAction({
  description: "List exercises logged for a specific date",
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

    const exercises = await db()
      .select()
      .from(schema.exercises)
      .where(eq(schema.exercises.date, date))
      .orderBy(desc(schema.exercises.created_at));

    return exercises;
  },
});
