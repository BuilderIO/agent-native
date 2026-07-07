/**
 * Reset a recording's non-destructive edits back to defaults.
 *
 * Clears `editsJson` entirely — trims, blurs, thumbnail spec. Does NOT touch
 * chapters (those live on `chaptersJson`) nor the stored `thumbnailUrl` /
 * `animatedThumbnailUrl` columns, so the user's current thumbnail stays in
 * place.
 *
 * Usage:
 *   pnpm action clear-edits --recordingId=<id>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { DEFAULT_EDITS, serializeEdits } from "../app/lib/timestamp-mapping.js";
import { getDb, schema } from "../server/db/index.js";
import { assertNativeRecordingMedia } from "./lib/native-media.js";

const MAX_CAS_ATTEMPTS = 5;

export default defineAction({
  description:
    "Reset a recording's edits (trims, blurs, thumbnail spec) back to defaults. Chapters and uploaded thumbnail URLs are kept.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");

    const db = getDb();

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

      const result = await db
        .update(schema.recordings)
        .set({
          editsJson: serializeEdits({ ...DEFAULT_EDITS }),
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
        console.log(`Cleared edits on ${args.recordingId}`);
        return { id: args.recordingId, editsJson: { ...DEFAULT_EDITS } };
      }
      // Someone else changed editsJson between our read and write — retry
      // against the now-current value.
    }

    throw new Error(
      `Could not clear edits on recording ${args.recordingId} after ${MAX_CAS_ATTEMPTS} concurrent attempts.`,
    );
  },
});
