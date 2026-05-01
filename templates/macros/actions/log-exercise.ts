import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  todayInTimezone,
} from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { z } from "zod";

export default defineAction({
  description:
    "Log an exercise with calories burned. This action writes the exercise row to the database and returns the saved row; after it succeeds, do not call db-schema, db-query, db-exec, docs-search, web-request/fetch, raw HTTP, or action HTTP endpoints to verify or insert the same exercise.",
  schema: z.object({
    name: z.string().min(1).describe("Exercise name"),
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
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const date = args.date || todayInTimezone();

    const result = await db()
      .insert(schema.exercises)
      .values({
        owner_email: ownerEmail,
        name: args.name,
        calories_burned: args.calories_burned || 0,
        duration_minutes: args.duration_minutes ?? null,
        date: String(date).split("T")[0],
      })
      .returning();

    return result[0];
  },
});
