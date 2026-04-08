import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";

export default defineAction({
  description: "Log an exercise with calories burned",
  parameters: {
    name: { type: "string", description: "Exercise name" },
    calories_burned: {
      type: "string",
      description: "Calories burned (number)",
    },
    duration_minutes: {
      type: "string",
      description: "Duration in minutes (optional)",
    },
    date: {
      type: "string",
      description: "Date in YYYY-MM-DD format (defaults to today)",
    },
  },
  run: async (args) => {
    const today = new Date();
    const date =
      args.date ||
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const result = await db()
      .insert(schema.exercises)
      .values({
        name: args.name,
        calories_burned: parseInt(args.calories_burned) || 0,
        duration_minutes: args.duration_minutes
          ? parseInt(args.duration_minutes)
          : null,
        date: String(date).split("T")[0],
        created_at: new Date(),
      })
      .returning();

    return result[0];
  },
});
