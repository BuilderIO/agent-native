import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { eq } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "Delete a meal, exercise, or weight entry by ID",
  schema: z.object({
    type: z
      .enum(["meal", "exercise", "weight"])
      .optional()
      .describe("Type of item to delete"),
    id: z.coerce.number().optional().describe("ID of the item to delete"),
  }),
  run: async (args) => {
    const id = args.id!;

    if (args.type === "meal") {
      await db().delete(schema.meals).where(eq(schema.meals.id, id));
    } else if (args.type === "exercise") {
      await db().delete(schema.exercises).where(eq(schema.exercises.id, id));
    } else if (args.type === "weight") {
      await db().delete(schema.weights).where(eq(schema.weights.id, id));
    }

    return { success: true, deleted: { type: args.type, id: args.id } };
  },
});
