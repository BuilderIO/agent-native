import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { z } from "zod";

export default defineAction({
  description: "Log an exercise with calories burned",
  schema: z.object({
    name: z.string().optional().describe("Exercise name"),
    calories_burned: z.coerce.number().optional().describe("Calories burned"),
    duration_minutes: z.coerce
      .number()
      .optional()
      .describe("Duration in minutes"),
    date: z
      .string()
      .optional()
      .describe("Date in YYYY-MM-DD format (defaults to today)"),
  }),
  run: async (args) => {
    const today = new Date();
    const date =
      args.date ||
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const result = await db()
      .insert(schema.exercises)
      .values({
        owner_email: getRequestUserEmail() ?? null,
        name: args.name,
        calories_burned: args.calories_burned || 0,
        duration_minutes: args.duration_minutes ?? null,
        date: String(date).split("T")[0],
      })
      .returning();

    return result[0];
  },
});
