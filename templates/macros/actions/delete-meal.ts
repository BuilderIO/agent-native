import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { eq } from "drizzle-orm";

export default defineAction({
  description: "Delete a meal by ID",
  parameters: {
    id: { type: "string", description: "Meal ID to delete" },
  },
  run: async (args) => {
    const id = Number(args.id);
    await db().delete(schema.meals).where(eq(schema.meals.id, id));
    return { success: true };
  },
});
