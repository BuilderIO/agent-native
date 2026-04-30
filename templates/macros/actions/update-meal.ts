import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

type MealChanges = Partial<typeof schema.meals.$inferInsert>;

export default defineAction({
  description: "Update an existing meal",
  schema: z.object({
    id: z.coerce.number().describe("Meal ID"),
    name: z.string().optional().describe("Meal name"),
    calories: z.coerce.number().optional().describe("Calories"),
    protein: z.coerce.number().optional().describe("Protein in grams"),
    carbs: z.coerce.number().optional().describe("Carbs in grams"),
    fat: z.coerce.number().optional().describe("Fat in grams"),
    date: z.string().optional().describe("Date in YYYY-MM-DD format"),
    image_url: z.string().optional().describe("Image URL"),
    notes: z.string().optional().describe("Notes"),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const changes: MealChanges = {};
    if (args.name !== undefined) changes.name = args.name;
    if (args.calories !== undefined) changes.calories = args.calories;
    if (args.protein !== undefined) changes.protein = args.protein;
    if (args.carbs !== undefined) changes.carbs = args.carbs;
    if (args.fat !== undefined) changes.fat = args.fat;
    if (args.date !== undefined) changes.date = String(args.date).split("T")[0];
    if (args.image_url !== undefined) changes.image_url = args.image_url || null;
    if (args.notes !== undefined) changes.notes = args.notes;

    const result = await db()
      .update(schema.meals)
      .set(changes)
      .where(
        and(
          eq(schema.meals.id, args.id),
          eq(schema.meals.owner_email, ownerEmail),
        ),
      )
      .returning();

    return result[0];
  },
});
