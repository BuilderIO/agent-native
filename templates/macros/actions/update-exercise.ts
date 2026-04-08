import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { eq } from "drizzle-orm";

export default defineAction({
  description: "Update an existing exercise",
  parameters: {
    id: { type: "string", description: "Exercise ID" },
    name: { type: "string", description: "Exercise name" },
    calories_burned: { type: "string", description: "Calories burned" },
    duration_minutes: { type: "string", description: "Duration in minutes" },
    date: { type: "string", description: "Date in YYYY-MM-DD format" },
  },
  run: async (args) => {
    const id = Number(args.id);
    const result = await db()
      .update(schema.exercises)
      .set({
        name: args.name,
        calories_burned: args.calories_burned
          ? parseInt(args.calories_burned)
          : undefined,
        duration_minutes: args.duration_minutes
          ? parseInt(args.duration_minutes)
          : undefined,
        date: args.date ? String(args.date).split("T")[0] : undefined,
      })
      .where(eq(schema.exercises.id, id))
      .returning();

    return result[0];
  },
});
