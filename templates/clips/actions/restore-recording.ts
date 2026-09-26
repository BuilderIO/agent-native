/**
 * Restore a recording — clears archivedAt and trashedAt.
 *
 * Usage:
 *   pnpm action restore-recording --id=<id>
 */

import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { isImageRecording } from "@shared/recording-kind";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { hasDeleteClaim } from "../server/lib/screenshot-edits.js";

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
        kind: schema.recordings.kind,
        editsJson: schema.recordings.editsJson,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.id));
    if (!existing) throw new Error(`Recording not found: ${args.id}`);
    // A permanent delete has claimed this screenshot: it is running, or it
    // stopped part-way and some files — possibly the base still under
    // pending boxes — are gone. Either way it cannot come back whole.
    if (hasDeleteClaim(existing.editsJson)) {
      throw new Error(
        "This screenshot was partly deleted and cannot be restored. Delete it again to finish.",
      );
    }

    const now = new Date().toISOString();
    // Pinned to the unclaimed edits just read: a delete that claims the
    // screenshot in between must win, or a delete that then stops part-way
    // would put it back in the library without its base.
    const restored = await db
      .update(schema.recordings)
      .set({ archivedAt: null, trashedAt: null, updatedAt: now })
      .where(
        isImageRecording(existing)
          ? and(
              eq(schema.recordings.id, args.id),
              eq(schema.recordings.editsJson, existing.editsJson),
            )
          : eq(schema.recordings.id, args.id),
      )
      .returning({ id: schema.recordings.id });
    if (!restored.length) {
      throw new Error(
        "This screenshot changed while it was being restored. Nothing was restored — try again.",
      );
    }

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(`Restored recording ${args.id}`);
    return { id: args.id };
  },
});
