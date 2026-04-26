/**
 * Update a text expansion snippet.
 *
 * Usage:
 *   pnpm action update-snippet --id=<id> --expansion="New expansion text"
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/helpers.js";

export default defineAction({
  description:
    "Update an existing text expansion snippet's trigger, expansion, or team setting.",
  schema: z.object({
    id: z.string().describe("Snippet ID"),
    trigger: z.string().optional().describe("New trigger text"),
    expansion: z.string().optional().describe("New expansion text"),
    isTeam: z.boolean().optional().describe("Whether this is a team snippet"),
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
    if (!existing) return { id: args.id, error: "Snippet not found" };

    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (args.trigger !== undefined) updates.trigger = args.trigger.trim();
    if (args.expansion !== undefined) updates.expansion = args.expansion;
    if (args.isTeam !== undefined) updates.isTeam = args.isTeam;

    await db
      .update(schema.dictationSnippets)
      .set(updates)
      .where(eq(schema.dictationSnippets.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Updated snippet ${args.id}`);
    return { id: args.id, ...updates };
  },
});
