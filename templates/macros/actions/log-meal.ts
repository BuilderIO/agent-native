import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  todayInTimezone,
} from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { z } from "zod";

export default defineAction({
  description:
    "Log/add/record a meal entry with calories and optional macros. Use this for every user request to add a meal; do not use web-request/fetch/raw HTTP to create meals.",
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
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const date = args.date || todayInTimezone();

    const result = await db()
      .insert(schema.meals)
      .values({
        owner_email: ownerEmail,
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
