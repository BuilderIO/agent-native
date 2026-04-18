/**
 * Permanently delete a snippet and cascade its share + viewer rows.
 * Admin-only.
 *
 * Usage:
 *   pnpm action delete-snippet-permanent --id=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  parseSpaceIds,
  stringifySpaceIds,
  parseJson,
  resolveDefaultWorkspaceId,
} from "../server/lib/calls.js";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Permanently delete a snippet and cascade to snippet_shares and snippet_viewers. Admin role required — this cannot be undone.",
  schema: z.object({
    id: z.string().describe("Snippet id"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    await assertAccess("snippet", args.id, "admin");

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.snippets)
      .where(eq(schema.snippets.id, args.id))
      .limit(1);
    if (!existing) throw new Error(`Snippet not found: ${args.id}`);

    await db
      .delete(schema.snippetViewers)
      .where(eq(schema.snippetViewers.snippetId, args.id));
    await db
      .delete(schema.snippetShares)
      .where(eq(schema.snippetShares.resourceId, args.id));
    await db.delete(schema.snippets).where(eq(schema.snippets.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Permanently deleted snippet "${existing.title}" (${args.id})`);
    return { success: true, id: args.id };
  },
});

void getCurrentOwnerEmail;
void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
