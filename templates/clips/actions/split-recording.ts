/**
 * Mark a split point on a recording.
 *
 * A split is a zero-width, non-excluded entry in `editsJson.trims`. It does
 * not affect playback, but the editor UI uses it to let the user operate on
 * the segment before or after the split independently.
 *
 * Usage:
 *   pnpm action split-recording --recordingId=<id> --atMs=18500
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";
import {
  appendSplit,
  parseEdits,
  serializeEdits,
} from "../app/lib/timestamp-mapping.js";

export default defineAction({
  description:
    "Add a split marker at the given timestamp. A split is a UI-only marker — it does not change playback. Used to operate on segments independently.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    atMs: z.coerce
      .number()
      .int()
      .min(0)
      .describe("Split point in milliseconds (original time)"),
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

    const edits = parseEdits(existing.editsJson);
    const next = appendSplit(edits, args.atMs);

    await db
      .update(schema.recordings)
      .set({
        editsJson: serializeEdits(next),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.recordings.id, args.recordingId));

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Split ${args.recordingId} at ${args.atMs} ms`);

    return {
      id: args.recordingId,
      atMs: args.atMs,
      editsJson: next,
    };
  },
});
