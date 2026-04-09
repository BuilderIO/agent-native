import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { eq } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "Update an existing exercise",
  schema: z.object({
    id: z.coerce.number().optional().describe("Exercise ID"),
    name: z.string().optional().describe("Exercise name"),
    calories_burned: z.coerce.number().optional().describe("Calories burned"),
    duration_minutes: z.coerce
      .number()
      .optional()
      .describe("Duration in minutes"),
    date: z.string().optional().describe("Date in YYYY-MM-DD format"),
  }),
  run: async (args) => {
    const id = args.id!;
    const result = await db()
      .update(schema.exercises)
      .set({
        name: args.name,
        calories_burned: args.calories_burned ?? undefined,
        duration_minutes: args.duration_minutes ?? undefined,
        date: args.date ? String(args.date).split("T")[0] : undefined,
      })
      .where(eq(schema.exercises.id, id))
      .returning();

    return result[0];
  },
});
