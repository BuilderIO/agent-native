/**
 * Append a trim range to the recording's non-destructive edits.
 *
 * The range is stored in `editsJson.trims` with `excluded: true`. Playback
 * skips excluded ranges; the source video is never modified. If the new range
 * is adjacent to or overlaps an existing excluded range, they are merged.
 *
 * Usage:
 *   pnpm action trim-recording --recordingId=<id> --startMs=12000 --endMs=15000
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  mergeExcluded,
  parseEdits,
  serializeEdits,
} from "../app/lib/timestamp-mapping.js";
import { getDb, schema } from "../server/db/index.js";
import { assertNativeRecordingMedia } from "./lib/native-media.js";

const MAX_CAS_ATTEMPTS = 5;

export default defineAction({
  description:
    "Append a trim range to a recording. The range is excluded from playback but the source video is never modified. Adjacent/overlapping ranges are merged.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    startMs: z.coerce
      .number()
      .int()
      .min(0)
      .describe("Start of the trim range in milliseconds (original time)"),
    endMs: z.coerce
      .number()
      .int()
      .min(0)
      .describe("End of the trim range in milliseconds (original time)"),
  }),
  run: async (args) => {
    if (args.endMs <= args.startMs) {
      throw new Error("endMs must be greater than startMs");
    }

    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();

    let next: ReturnType<typeof mergeExcluded> | undefined;

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
      next = mergeExcluded(edits, args.startMs, args.endMs);

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
        console.log(
          `Trimmed ${args.recordingId}: ${args.startMs}–${args.endMs} ms (now ${next.trims.filter((t) => t.excluded).length} excluded ranges)`,
        );
        return {
          id: args.recordingId,
          editsJson: next,
          trimCount: next.trims.filter((t) => t.excluded).length,
        };
      }
      // Someone else changed editsJson between our read and write — retry
      // against the now-current value.
    }

    throw new Error(
      `Could not trim recording ${args.recordingId} after ${MAX_CAS_ATTEMPTS} concurrent attempts.`,
    );
  },
});
