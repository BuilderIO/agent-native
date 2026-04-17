import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { z } from "zod";

export default defineAction({
  description: "Log a meal with calories and optional macros",
  schema: z.object({
    name: z.string().optional().describe("Meal name"),
    calories: z.coerce.number().optional().describe("Calories"),
    protein: z.coerce.number().optional().describe("Protein in grams"),
    carbs: z.coerce.number().optional().describe("Carbs in grams"),
    fat: z.coerce.number().optional().describe("Fat in grams"),
    date: z
      .string()
      .optional()
      .describe("Date in YYYY-MM-DD format (defaults to today)"),
  }),
  run: async (args) => {
    const today = new Date();
    const date =
      args.date ||
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const result = await db()
      .insert(schema.meals)
      .values({
        owner_email: getRequestUserEmail() ?? null,
        name: args.name,
        calories: args.calories || 0,
        protein: args.protein ?? null,
        carbs: args.carbs ?? null,
        fat: args.fat ?? null,
        date: String(date).split("T")[0],
        image_url: null,
        notes: null,
      })
      .returning();

    return result[0];
  },
});
