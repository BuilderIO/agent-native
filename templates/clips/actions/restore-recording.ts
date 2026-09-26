/**
 * Restore a recording — clears archivedAt and trashedAt.
 *
 * Usage:
 *   pnpm action restore-recording --id=<id>
 */

import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  isClaimedForDelete,
  withoutDeleteClaim,
} from "../server/lib/screenshot-edits.js";

export default defineAction({
  description: "Restore a recording from archive or trash back to the library.",
  schema: z.object({
    id: z.string().describe("Recording ID"),
  }),
  run: async (args) => {
    await assertAccess("recording", args.id, "editor");

    const db = getDb();

    const [existing] = await db
      .select({
        id: schema.recordings.id,
        editsJson: schema.recordings.editsJson,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.id));
    if (!existing) throw new Error(`Recording not found: ${args.id}`);

    const now = new Date().toISOString();
    await db
      .update(schema.recordings)
      .set({ archivedAt: null, trashedAt: null, updatedAt: now })
      .where(eq(schema.recordings.id, args.id));
    // A permanent delete that died after claiming a screenshot leaves its
    // claim behind. Once it has expired it no longer blocks saves, and is
    // tidied away here. A live one is left alone: that delete is still
    // running, and lifting its claim would let a save land mid-delete.
    // Pinned to the edits read, so a change made meanwhile is kept.
    const editsJson = isClaimedForDelete(existing.editsJson)
      ? existing.editsJson
      : withoutDeleteClaim(existing.editsJson);
    if (editsJson !== existing.editsJson) {
      await db
        .update(schema.recordings)
        .set({ editsJson })
        .where(
          and(
            eq(schema.recordings.id, args.id),
            eq(schema.recordings.editsJson, existing.editsJson),
          ),
        );
    }

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Restored recording ${args.id}`);
    return { id: args.id };
  },
});
