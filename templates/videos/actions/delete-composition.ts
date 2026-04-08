import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Delete a composition by ID",
  parameters: {
    id: { type: "string", description: "Composition ID to delete" },
  },
  run: async (args) => {
    if (!args.id) {
      return { error: "Composition id is required" };
    }

    const db = getDb();
    const result = await db
      .delete(schema.compositions)
      .where(eq(schema.compositions.id, args.id))
      .returning();

    if (result.length > 0) {
      return { success: true };
    }

    return { error: "Composition not found" };
  },
});
