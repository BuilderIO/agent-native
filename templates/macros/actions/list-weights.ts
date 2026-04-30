import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "List weight entries for a specific date",
  schema: z.object({
    date: z
      .string()
      .optional()
      .describe("Date in YYYY-MM-DD format (defaults to today)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const today = new Date();
    const date =
      args.date ||
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) return [];

    return await db()
      .select()
      .from(schema.weights)
      .where(
        and(
          eq(schema.weights.date, date),
          eq(schema.weights.owner_email, ownerEmail),
        ),
      )
      .orderBy(desc(schema.weights.created_at));
  },
});
