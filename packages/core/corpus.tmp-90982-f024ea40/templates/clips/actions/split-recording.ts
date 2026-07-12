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
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  appendSplit,
  parseEdits,
  serializeEdits,
} from "../app/lib/timestamp-mapping.js";
import { getDb, schema } from "../server/db/index.js";
import { assertNativeRecordingMedia } from "./lib/native-media.js";

const MAX_CAS_ATTEMPTS = 5;

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
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();

    let next: ReturnType<typeof appendSplit> | undefined;

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const [existing] = await db
        .select()
        .from(schema.recordings)
        .where(eq(schema.recordings.id, args.recordingId));
      if (!existing) {
        throw new Error(`Recording not found: ${args.recordingId}`);
      }
      assertNativeRecordingMedia(existing);

      const previousEditsJson = existing.editsJson;
      const edits = parseEdits(previousEditsJson);
      next = appendSplit(edits, args.atMs);

      const result = await db
        .update(schema.recordings)
        .set({
          editsJson: serializeEdits(next),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.recordings.id, args.recordingId),
            previousEditsJson == null
              ? isNull(schema.recordings.editsJson)
              : eq(schema.recordings.editsJson, previousEditsJson),
          ),
        )
        .returning({ id: schema.recordings.id });

      if (result.length > 0) {
        await writeAppState("refresh-signal", { ts: Date.now() });
        console.log(`Split ${args.recordingId} at ${args.atMs} ms`);
        return {
          id: args.recordingId,
          atMs: args.atMs,
          editsJson: next,
        };
      }
      // Someone else changed editsJson between our read and write — retry
      // against the now-current value.
    }

    throw new Error(
      `Could not split recording ${args.recordingId} after ${MAX_CAS_ATTEMPTS} concurrent attempts.`,
    );
  },
});
