import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { eq } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "Delete an exercise by ID",
  schema: z.object({
    id: z.coerce.number().optional().describe("Exercise ID to delete"),
  }),
  run: async (args) => {
    const id = args.id!;
    await db().delete(schema.exercises).where(eq(schema.exercises.id, id));
    return { success: true };
  },
});
