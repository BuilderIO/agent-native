import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { eq, desc, and, or, isNull } from "drizzle-orm";
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

    const ownerEmail = process.env.AGENT_USER_EMAIL;
    return await db()
      .select()
      .from(schema.weights)
      .where(
        and(
          eq(schema.weights.date, date),
          ownerEmail
            ? or(
                eq(schema.weights.owner_email, ownerEmail),
                isNull(schema.weights.owner_email),
              )
            : undefined,
        ),
      )
      .orderBy(desc(schema.weights.created_at));
  },
});
