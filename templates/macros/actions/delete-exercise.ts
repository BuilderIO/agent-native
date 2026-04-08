import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { eq } from "drizzle-orm";

export default defineAction({
  description: "Delete an exercise by ID",
  parameters: {
    id: { type: "string", description: "Exercise ID to delete" },
  },
  run: async (args) => {
    const id = Number(args.id);
    await db().delete(schema.exercises).where(eq(schema.exercises.id, id));
    return { success: true };
  },
});
