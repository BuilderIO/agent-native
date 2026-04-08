import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";

export default defineAction({
  description: "Log a meal with calories and optional macros",
  parameters: {
    name: { type: "string", description: "Meal name" },
    calories: { type: "string", description: "Calories (number)" },
    protein: {
      type: "string",
      description: "Protein in grams (optional)",
    },
    carbs: { type: "string", description: "Carbs in grams (optional)" },
    fat: { type: "string", description: "Fat in grams (optional)" },
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
      .insert(schema.meals)
      .values({
        name: args.name,
        calories: parseInt(args.calories) || 0,
        protein: args.protein ? parseFloat(args.protein) : null,
        carbs: args.carbs ? parseFloat(args.carbs) : null,
        fat: args.fat ? parseFloat(args.fat) : null,
        date: String(date).split("T")[0],
        image_url: null,
        notes: null,
      })
      .returning();

    return result[0];
  },
});
