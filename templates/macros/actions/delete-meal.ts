import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "Delete a meal by ID",
  schema: z.object({
    id: z.coerce.number().optional().describe("Meal ID to delete"),
  }),
  run: async (args) => {
    const id = args.id!;
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    await db()
      .delete(schema.meals)
      .where(
        and(eq(schema.meals.id, id), eq(schema.meals.owner_email, ownerEmail)),
      );
    return { success: true };
  },
});
