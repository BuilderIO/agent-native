/**
 * Append a trim range to the recording's non-destructive edits.
 *
 * The range is stored in `editsJson.trims` with `excluded: true`. Playback
 * skips excluded ranges; the source video is never modified. If the new range
 * is adjacent to or overlaps an existing excluded range, they are merged.
 *
 * Usage:
 *   pnpm action trim-recording --id=<id> --startMs=12000 --endMs=15000
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";
import {
  mergeExcluded,
  parseEdits,
  serializeEdits,
} from "../app/lib/timestamp-mapping.js";

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
    const next = mergeExcluded(edits, args.startMs, args.endMs);

    await db
      .update(schema.recordings)
      .set({
        editsJson: serializeEdits(next),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.recordings.id, args.recordingId));

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Trimmed ${args.recordingId}: ${args.startMs}–${args.endMs} ms (now ${next.trims.filter((t) => t.excluded).length} excluded ranges)`,
    );

    return {
      id: args.recordingId,
      editsJson: next,
      trimCount: next.trims.filter((t) => t.excluded).length,
    };
  },
});
