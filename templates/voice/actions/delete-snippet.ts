/**
 * Delete a text expansion snippet.
 *
 * Usage:
 *   pnpm action delete-snippet --id=<id>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/helpers.js";

export default defineAction({
  description: "Delete a text expansion snippet by ID. Only the owner can delete.",
  schema: z.object({
    id: z.string().describe("Snippet ID"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const [existing] = await db
      .select({ id: schema.dictationSnippets.id })
      .from(schema.dictationSnippets)
      .where(
        and(
          eq(schema.dictationSnippets.id, args.id),
          eq(schema.dictationSnippets.ownerEmail, ownerEmail),
        ),
      );
    if (!existing) throw new Error(`Snippet not found: ${args.id}`);

    await db
      .delete(schema.dictationSnippets)
      .where(eq(schema.dictationSnippets.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Deleted snippet ${args.id}`);
    return { id: args.id, deleted: true };
  },
});
