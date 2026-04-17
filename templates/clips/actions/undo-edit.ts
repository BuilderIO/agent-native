/**
 * Pop the most-recently-added excluded trim from a recording.
 *
 * There is no redo stack — this action is a simple LIFO pop over
 * `editsJson.trims.filter(t => t.excluded)`. Split markers are ignored.
 *
 * Usage:
 *   pnpm action undo-edit --recordingId=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";
import {
  parseEdits,
  popLastExcluded,
  serializeEdits,
} from "../app/lib/timestamp-mapping.js";

export default defineAction({
  description:
    "Undo the last trim on a recording by removing the most-recently-added excluded range. No redo.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const [existing] = await db
      .select()
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, args.recordingId),
          eq(schema.recordings.ownerEmail, ownerEmail),
        ),
      );
    if (!existing) {
      throw new Error(`Recording not found: ${args.recordingId}`);
    }

    const before = parseEdits(existing.editsJson);
    const after = popLastExcluded(before);

    if (before.trims.length === after.trims.length) {
      console.log(`No trim to undo on ${args.recordingId}`);
      return { id: args.recordingId, undone: false, editsJson: after };
    }

    await db
      .update(schema.recordings)
      .set({
        editsJson: serializeEdits(after),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.recordings.id, args.recordingId));

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Undid last trim on ${args.recordingId} (now ${after.trims.filter((t) => t.excluded).length} excluded ranges)`,
    );

    return { id: args.recordingId, undone: true, editsJson: after };
  },
});
