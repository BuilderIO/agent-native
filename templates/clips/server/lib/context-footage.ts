import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

// The Clip an earlier-screen-time footage recording is attached to, or null for
// any other recording. Viewers reach the footage only through that Clip, so
// every media route evaluates the Clip's access rules instead of the footage's
// own row, which can carry a stray direct share.
export async function contextClipIdForFootage(
  footageId: string,
): Promise<string | null> {
  const [item] = await getDb()
    .select({ recordingId: schema.recordingContextItems.recordingId })
    .from(schema.recordingContextItems)
    .where(
      and(
        eq(schema.recordingContextItems.mediaRecordingId, footageId),
        eq(schema.recordingContextItems.status, "ready"),
      ),
    )
    .limit(1);
  return item?.recordingId ?? null;
}
