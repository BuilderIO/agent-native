import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { eq, and, or, isNull } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "Delete a meal by ID",
  schema: z.object({
    id: z.coerce.number().optional().describe("Meal ID to delete"),
  }),
  run: async (args) => {
    const id = args.id!;
    const ownerEmail = getRequestUserEmail();
    await db()
      .delete(schema.meals)
      .where(
        and(
          eq(schema.meals.id, id),
          ownerEmail
            ? or(
                eq(schema.meals.owner_email, ownerEmail),
                isNull(schema.meals.owner_email),
              )
            : undefined,
        ),
      );
    return { success: true };
  },
});
