import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Delete a composition by ID",
  schema: z.object({
    id: z.string().optional().describe("Composition ID to delete"),
  }),
  run: async (args) => {
    if (!args.id) {
      return { error: "Composition id is required" };
    }

    const db = getDb();
    await db
      .delete(schema.compositions)
      .where(eq(schema.compositions.id, args.id));

    return { success: true };
  },
});
