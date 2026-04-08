import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { eq } from "drizzle-orm";

export default defineAction({
  description: "Update an existing meal",
  parameters: {
    id: { type: "string", description: "Meal ID" },
    name: { type: "string", description: "Meal name" },
    calories: { type: "string", description: "Calories" },
    protein: { type: "string", description: "Protein in grams" },
    carbs: { type: "string", description: "Carbs in grams" },
    fat: { type: "string", description: "Fat in grams" },
    date: { type: "string", description: "Date in YYYY-MM-DD format" },
    image_url: { type: "string", description: "Image URL" },
    notes: { type: "string", description: "Notes" },
  },
  run: async (args) => {
    const id = Number(args.id);
    const result = await db()
      .update(schema.meals)
      .set({
        name: args.name,
        calories: args.calories ? parseInt(args.calories) : undefined,
        protein:
          args.protein !== undefined
            ? parseFloat(args.protein) || null
            : undefined,
        carbs:
          args.carbs !== undefined ? parseFloat(args.carbs) || null : undefined,
        fat: args.fat !== undefined ? parseFloat(args.fat) || null : undefined,
        date: args.date ? String(args.date).split("T")[0] : undefined,
        image_url: args.image_url || null,
        notes: args.notes ?? null,
      })
      .where(eq(schema.meals.id, id))
      .returning();

    return result[0];
  },
});
