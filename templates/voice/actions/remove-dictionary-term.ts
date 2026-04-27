/**
 * Remove a dictionary term.
 *
 * Usage:
 *   pnpm action remove-dictionary-term --id=<id>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/helpers.js";

export default defineAction({
  description: "Remove a term from the custom dictionary.",
  schema: z.object({
    id: z.string().describe("Dictionary term ID"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const [existing] = await db
      .select({ id: schema.dictationDictionary.id })
      .from(schema.dictationDictionary)
      .where(
        and(
          eq(schema.dictationDictionary.id, args.id),
          eq(schema.dictationDictionary.ownerEmail, ownerEmail),
        ),
      );
    if (!existing)
      return {
        id: args.id,
        deleted: false,
        error: "Dictionary term not found",
      };

    await db
      .delete(schema.dictationDictionary)
      .where(eq(schema.dictationDictionary.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Removed dictionary term ${args.id}`);
    return { id: args.id, deleted: true };
  },
});
