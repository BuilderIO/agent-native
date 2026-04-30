import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "Delete an exercise by ID",
  schema: z.object({
    id: z.coerce.number().optional().describe("Exercise ID to delete"),
  }),
  run: async (args) => {
    const id = args.id!;
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    await db()
      .delete(schema.exercises)
      .where(
        and(
          eq(schema.exercises.id, id),
          eq(schema.exercises.owner_email, ownerEmail),
        ),
      );
    return { success: true };
  },
});
