import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { eq, and, or, isNull } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "Update an existing weight entry",
  schema: z.object({
    id: z.coerce.number().optional().describe("Weight entry ID"),
    weight: z.coerce.number().optional().describe("Weight in pounds"),
    date: z.string().optional().describe("Date in YYYY-MM-DD format"),
    notes: z.string().optional().describe("Notes"),
  }),
  run: async (args) => {
    const id = args.id!;
    const ownerEmail = getRequestUserEmail();
    const result = await db()
      .update(schema.weights)
      .set({
        weight: args.weight ?? undefined,
        date: args.date ? String(args.date).split("T")[0] : undefined,
        notes: args.notes ?? null,
      })
      .where(
        and(
          eq(schema.weights.id, id),
          ownerEmail
            ? or(
                eq(schema.weights.owner_email, ownerEmail),
                isNull(schema.weights.owner_email),
              )
            : undefined,
        ),
      )
      .returning();

    return result[0];
  },
});
