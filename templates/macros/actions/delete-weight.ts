import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { eq } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "Delete a weight entry by ID",
  schema: z.object({
    id: z.coerce.number().optional().describe("Weight entry ID to delete"),
  }),
  run: async (args) => {
    const id = args.id!;
    await db().delete(schema.weights).where(eq(schema.weights.id, id));
    return { success: true };
  },
});
