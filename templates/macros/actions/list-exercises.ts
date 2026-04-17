import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { eq, desc, and, or, isNull } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "List exercises logged for a specific date",
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
    const exercises = await db()
      .select()
      .from(schema.exercises)
      .where(
        and(
          eq(schema.exercises.date, date),
          ownerEmail
            ? or(
                eq(schema.exercises.owner_email, ownerEmail),
                isNull(schema.exercises.owner_email),
              )
            : undefined,
        ),
      )
      .orderBy(desc(schema.exercises.created_at));

    return exercises;
  },
});
