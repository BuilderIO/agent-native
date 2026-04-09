import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { z } from "zod";

export default defineAction({
  description: "Log a weight entry",
  schema: z.object({
    weight: z.coerce.number().optional().describe("Weight in pounds"),
    date: z
      .string()
      .optional()
      .describe("Date in YYYY-MM-DD format (defaults to today)"),
    notes: z.string().optional().describe("Optional notes"),
  }),
  run: async (args) => {
    const today = new Date();
    const date =
      args.date ||
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const result = await db()
      .insert(schema.weights)
      .values({
        weight: args.weight!,
        date: String(date).split("T")[0],
        notes: args.notes || null,
        created_at: new Date(),
      })
      .returning();

    return result[0];
  },
});
