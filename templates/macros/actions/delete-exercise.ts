import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { db, schema } from "../server/db/index.js";
import { eq, and, or, isNull } from "drizzle-orm";
import { z } from "zod";

export default defineAction({
  description: "Delete an exercise by ID",
  schema: z.object({
    id: z.coerce.number().optional().describe("Exercise ID to delete"),
  }),
  run: async (args) => {
    const id = args.id!;
    const ownerEmail = getRequestUserEmail();
    await db()
      .delete(schema.exercises)
      .where(
        and(
          eq(schema.exercises.id, id),
          ownerEmail
            ? or(
                eq(schema.exercises.owner_email, ownerEmail),
                isNull(schema.exercises.owner_email),
              )
            : undefined,
        ),
      );
    return { success: true };
  },
});
