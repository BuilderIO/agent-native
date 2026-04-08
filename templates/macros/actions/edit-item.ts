import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { eq } from "drizzle-orm";

export default defineAction({
  description: "Edit an existing meal, exercise, or weight entry",
  parameters: {
    type: {
      type: "string",
      enum: ["meal", "exercise", "weight"],
      description: "Type of item",
    },
    id: { type: "string", description: "ID of the item" },
    name: {
      type: "string",
      description: "New name (meals/exercises only)",
    },
    calories: { type: "string", description: "New calories (meals only)" },
    protein: {
      type: "string",
      description: "New protein in grams (meals only)",
    },
    carbs: {
      type: "string",
      description: "New carbs in grams (meals only)",
    },
    fat: { type: "string", description: "New fat in grams (meals only)" },
    calories_burned: {
      type: "string",
      description: "New calories burned (exercises only)",
    },
    weight: {
      type: "string",
      description: "New weight in lbs (weight entries only)",
    },
    notes: {
      type: "string",
      description: "Notes (weight entries only)",
    },
  },
  run: async (args) => {
    const id = Number(args.id);

    if (args.type === "meal") {
      const updates: Record<string, any> = {};
      if (args.name) updates.name = args.name;
      if (args.calories) updates.calories = parseInt(args.calories);
      if (args.protein) updates.protein = parseInt(args.protein);
      if (args.carbs) updates.carbs = parseInt(args.carbs);
      if (args.fat) updates.fat = parseInt(args.fat);

      const result = await db()
        .update(schema.meals)
        .set(updates)
        .where(eq(schema.meals.id, id))
        .returning();
      return result[0];
    } else if (args.type === "exercise") {
      const updates: Record<string, any> = {};
      if (args.name) updates.name = args.name;
      if (args.calories_burned)
        updates.calories_burned = parseInt(args.calories_burned);

      const result = await db()
        .update(schema.exercises)
        .set(updates)
        .where(eq(schema.exercises.id, id))
        .returning();
      return result[0];
    } else if (args.type === "weight") {
      const updates: Record<string, any> = {};
      if (args.weight) updates.weight = parseFloat(args.weight);
      if (args.notes) updates.notes = args.notes;

      const result = await db()
        .update(schema.weights)
        .set(updates)
        .where(eq(schema.weights.id, id))
        .returning();
      return result[0];
    }

    return { success: false, error: "Invalid type" };
  },
});
