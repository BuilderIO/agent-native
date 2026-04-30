import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "Delete a weight entry by ID",
  schema: z.object({
    id: z.coerce.number().describe("Weight entry ID to delete"),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    await db()
      .delete(schema.weights)
      .where(
        and(
          eq(schema.weights.id, args.id),
          eq(schema.weights.owner_email, ownerEmail),
        ),
      );
    return { success: true };
  },
});
