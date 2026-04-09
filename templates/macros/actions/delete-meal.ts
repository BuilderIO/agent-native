import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { eq } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "Delete a meal by ID",
  schema: z.object({
    id: z.coerce.number().optional().describe("Meal ID to delete"),
  }),
  run: async (args) => {
    const id = args.id!;
    await db().delete(schema.meals).where(eq(schema.meals.id, id));
    return { success: true };
  },
});
