import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { eq } from "drizzle-orm";

export default defineAction({
  description: "Delete a weight entry by ID",
  parameters: {
    id: { type: "string", description: "Weight entry ID to delete" },
  },
  run: async (args) => {
    const id = Number(args.id);
    await db().delete(schema.weights).where(eq(schema.weights.id, id));
    return { success: true };
  },
});
