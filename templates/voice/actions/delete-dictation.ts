/**
 * Delete a dictation.
 *
 * Usage:
 *   pnpm action delete-dictation --id=<id>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/helpers.js";

export default defineAction({
  description: "Delete a dictation by ID. Only the owner can delete.",
  schema: z.object({
    id: z.string().describe("Dictation ID"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const [existing] = await db
      .select({ id: schema.dictations.id })
      .from(schema.dictations)
      .where(
        and(
          eq(schema.dictations.id, args.id),
          eq(schema.dictations.ownerEmail, ownerEmail),
        ),
      );
    if (!existing) throw new Error(`Dictation not found: ${args.id}`);

    await db
      .delete(schema.dictations)
      .where(eq(schema.dictations.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Deleted dictation ${args.id}`);
    return { id: args.id, deleted: true };
  },
});
