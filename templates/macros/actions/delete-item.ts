import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { eq, and } from "drizzle-orm";
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
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    if (args.type === "meal") {
      await db()
        .delete(schema.meals)
        .where(
          and(
            eq(schema.meals.id, id),
            eq(schema.meals.owner_email, ownerEmail),
          ),
        );
    } else if (args.type === "exercise") {
      await db()
        .delete(schema.exercises)
        .where(
          and(
            eq(schema.exercises.id, id),
            eq(schema.exercises.owner_email, ownerEmail),
          ),
        );
    } else if (args.type === "weight") {
      await db()
        .delete(schema.weights)
        .where(
          and(
            eq(schema.weights.id, id),
            eq(schema.weights.owner_email, ownerEmail),
          ),
        );
    }

    return { success: true, deleted: { type: args.type, id: args.id } };
  },
});
