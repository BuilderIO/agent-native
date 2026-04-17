import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { eq, and, or, isNull } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "Delete a weight entry by ID",
  schema: z.object({
    id: z.coerce.number().optional().describe("Weight entry ID to delete"),
  }),
  run: async (args) => {
    const id = args.id!;
    const ownerEmail = getRequestUserEmail();
    await db()
      .delete(schema.weights)
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
      );
    return { success: true };
  },
});
