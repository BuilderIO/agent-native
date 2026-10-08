import { writeAppState } from "@agent-native/core/application-state";
import { and, eq, isNull } from "drizzle-orm";

import {
  type EditsJson,
  mergeExcluded,
  parseEdits,
  serializeEdits,
} from "../../app/lib/timestamp-mapping.js";
import { getDb, schema } from "../../server/db/index.js";
import type { TrimRange } from "../../shared/silence-ranges.js";
import { assertNativeRecordingMedia } from "./native-media.js";

const MAX_CAS_ATTEMPTS = 5;

export interface ApplyTrimsResult {
  editsJson: EditsJson;
  trimCount: number;
}

/** Callers must assert editor access before applying trims. */
export async function applyTrims(
  recordingId: string,
  ranges: readonly TrimRange[],
): Promise<ApplyTrimsResult> {
  const db = getDb();

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const [existing] = await db
      .select()
      .from(schema.recordings)
      .where(eq(schema.recordings.id, recordingId));
    if (!existing) {
      throw new Error(`Recording not found: ${recordingId}`);
    }
    assertNativeRecordingMedia(existing);

    const previousEditsJson = existing.editsJson;
    const next = ranges.reduce(
      (edits, range) => mergeExcluded(edits, range.startMs, range.endMs),
      parseEdits(previousEditsJson),
    );

    const result = await db
      .update(schema.recordings)
      .set({
        editsJson: serializeEdits(next),
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          previousEditsJson == null
            ? isNull(schema.recordings.editsJson)
            : eq(schema.recordings.editsJson, previousEditsJson),
        ),
      )
      .returning({ id: schema.recordings.id });

    if (result.length > 0) {
      await writeAppState("refresh-signal", { ts: Date.now() });
      return {
        editsJson: next,
        trimCount: next.trims.filter((t) => t.excluded).length,
      };
    }
    // Someone else changed editsJson between our read and write — retry
    // against the now-current value.
  }

  throw new Error(
    `Could not trim recording ${recordingId} after ${MAX_CAS_ATTEMPTS} concurrent attempts.`,
  );
}
