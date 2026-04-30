import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "Update an existing meal",
  schema: z.object({
    id: z.coerce.number().optional().describe("Meal ID"),
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
    const id = args.id!;
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const result = await db()
      .update(schema.meals)
      .set({
        name: args.name,
        calories: args.calories ?? undefined,
        protein: args.protein ?? undefined,
        carbs: args.carbs ?? undefined,
        fat: args.fat ?? undefined,
        date: args.date ? String(args.date).split("T")[0] : undefined,
        image_url: args.image_url || null,
        notes: args.notes ?? null,
      })
      .where(
        and(eq(schema.meals.id, id), eq(schema.meals.owner_email, ownerEmail)),
      )
      .returning();

    return result[0];
  },
});
