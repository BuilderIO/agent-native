import { defineAction } from "@agent-native/core";
import { db, schema } from "../server/db/index.js";
import { eq } from "drizzle-orm";

export default defineAction({
  description: "Update an existing weight entry",
  parameters: {
    id: { type: "string", description: "Weight entry ID" },
    weight: { type: "string", description: "Weight in pounds" },
    date: { type: "string", description: "Date in YYYY-MM-DD format" },
    notes: { type: "string", description: "Notes" },
  },
  run: async (args) => {
    const id = Number(args.id);
    const result = await db()
      .update(schema.weights)
      .set({
        weight: args.weight ? parseFloat(args.weight) : undefined,
        date: args.date ? String(args.date).split("T")[0] : undefined,
        notes: args.notes ?? null,
      })
      .where(eq(schema.weights.id, id))
      .returning();

    return result[0];
  },
});
