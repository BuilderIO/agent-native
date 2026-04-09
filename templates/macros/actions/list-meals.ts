import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { eq, desc, and, or, isNull } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "List meals logged for a specific date",
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
    const meals = await db()
      .select()
      .from(schema.meals)
      .where(
        and(
          eq(schema.meals.date, date),
          ownerEmail
            ? or(
                eq(schema.meals.owner_email, ownerEmail),
                isNull(schema.meals.owner_email),
              )
            : undefined,
        ),
      )
      .orderBy(desc(schema.meals.created_at));

    return meals;
  },
});
