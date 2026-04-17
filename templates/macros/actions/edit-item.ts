import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { eq, and, or, isNull } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "Edit an existing meal, exercise, or weight entry",
  schema: z.object({
    type: z
      .enum(["meal", "exercise", "weight"])
      .optional()
      .describe("Type of item"),
    id: z.coerce.number().optional().describe("ID of the item"),
    name: z.string().optional().describe("New name (meals/exercises only)"),
    calories: z.coerce
      .number()
      .optional()
      .describe("New calories (meals only)"),
    protein: z.coerce
      .number()
      .optional()
      .describe("New protein in grams (meals only)"),
    carbs: z.coerce
      .number()
      .optional()
      .describe("New carbs in grams (meals only)"),
    fat: z.coerce.number().optional().describe("New fat in grams (meals only)"),
    calories_burned: z.coerce
      .number()
      .optional()
      .describe("New calories burned (exercises only)"),
    weight: z.coerce
      .number()
      .optional()
      .describe("New weight in lbs (weight entries only)"),
    notes: z.string().optional().describe("Notes (weight entries only)"),
  }),
  run: async (args) => {
    const id = args.id!;
    const ownerEmail = getRequestUserEmail();
    const ownerFilter = (col: any) =>
      ownerEmail ? or(eq(col, ownerEmail), isNull(col)) : undefined;

    if (args.type === "meal") {
      const updates: Record<string, any> = {};
      if (args.name) updates.name = args.name;
      if (args.calories) updates.calories = args.calories;
      if (args.protein) updates.protein = args.protein;
      if (args.carbs) updates.carbs = args.carbs;
      if (args.fat) updates.fat = args.fat;

      const result = await db()
        .update(schema.meals)
        .set(updates)
        .where(
          and(eq(schema.meals.id, id), ownerFilter(schema.meals.owner_email)),
        )
        .returning();
      return result[0];
    } else if (args.type === "exercise") {
      const updates: Record<string, any> = {};
      if (args.name) updates.name = args.name;
      if (args.calories_burned) updates.calories_burned = args.calories_burned;

      const result = await db()
        .update(schema.exercises)
        .set(updates)
        .where(
          and(
            eq(schema.exercises.id, id),
            ownerFilter(schema.exercises.owner_email),
          ),
        )
        .returning();
      return result[0];
    } else if (args.type === "weight") {
      const updates: Record<string, any> = {};
      if (args.weight) updates.weight = args.weight;
      if (args.notes) updates.notes = args.notes;

      const result = await db()
        .update(schema.weights)
        .set(updates)
        .where(
          and(
            eq(schema.weights.id, id),
            ownerFilter(schema.weights.owner_email),
          ),
        )
        .returning();
      return result[0];
    }

    return { success: false, error: "Invalid type" };
  },
});
