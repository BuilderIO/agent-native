import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

type WeightChanges = Partial<typeof schema.weights.$inferInsert>;

export default defineAction({
  description: "Update an existing weight entry",
  schema: z.object({
    id: z.coerce.number().describe("Weight entry ID"),
    weight: z.coerce.number().optional().describe("Weight in pounds"),
    date: z.string().optional().describe("Date in YYYY-MM-DD format"),
    notes: z.string().optional().describe("Notes"),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const changes: WeightChanges = {};
    if (args.weight !== undefined) changes.weight = args.weight;
    if (args.date !== undefined) changes.date = String(args.date).split("T")[0];
    if (args.notes !== undefined) changes.notes = args.notes;

    const result = await db()
      .update(schema.weights)
      .set(changes)
      .where(
        and(
          eq(schema.weights.id, args.id),
          eq(schema.weights.owner_email, ownerEmail),
        ),
      )
      .returning();

    return result[0];
  },
});
