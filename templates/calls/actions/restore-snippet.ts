/**
 * Restore a soft-deleted snippet by clearing trashed_at.
 *
 * Usage:
 *   pnpm action restore-snippet --id=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description: "Restore a soft-deleted snippet by clearing trashed_at.",
  schema: z.object({
    id: z.string().describe("Snippet id"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    await assertAccess("snippet", args.id, "editor");

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.snippets)
      .where(eq(schema.snippets.id, args.id))
      .limit(1);
    if (!existing) throw new Error(`Snippet not found: ${args.id}`);

    const now = new Date().toISOString();
    await db
      .update(schema.snippets)
      .set({ trashedAt: null, updatedAt: now })
      .where(eq(schema.snippets.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Restored snippet ${args.id}`);
    return { id: args.id, trashedAt: null };
  },
});
