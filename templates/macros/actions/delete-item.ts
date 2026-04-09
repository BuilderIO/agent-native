import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { eq, and, or, isNull } from "drizzle-orm";
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
    const ownerEmail = process.env.AGENT_USER_EMAIL;
    const ownerFilter = (col: any) =>
      ownerEmail ? or(eq(col, ownerEmail), isNull(col)) : undefined;

    if (args.type === "meal") {
      await db()
        .delete(schema.meals)
        .where(
          and(eq(schema.meals.id, id), ownerFilter(schema.meals.owner_email)),
        );
    } else if (args.type === "exercise") {
      await db()
        .delete(schema.exercises)
        .where(
          and(
            eq(schema.exercises.id, id),
            ownerFilter(schema.exercises.owner_email),
          ),
        );
    } else if (args.type === "weight") {
      await db()
        .delete(schema.weights)
        .where(
          and(
            eq(schema.weights.id, id),
            ownerFilter(schema.weights.owner_email),
          ),
        );
    }

    return { success: true, deleted: { type: args.type, id: args.id } };
  },
});
