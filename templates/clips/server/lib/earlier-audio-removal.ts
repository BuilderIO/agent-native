import { eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

/**
 * When earlier audio was last removed from a recording's transcript. A writer
 * that sends transcript text to a model compares this across the call, so words
 * the user removed meanwhile don't land in what it saves.
 */
export async function readEarlierAudioRemovedAt(
  reader: Pick<ReturnType<typeof getDb>, "select">,
  recordingId: string | null,
): Promise<string | null> {
  if (!recordingId) return null;
  const rows = await reader
    .select({ removedAt: schema.recordingTranscripts.earlierAudioRemovedAt })
    .from(schema.recordingTranscripts)
    .where(eq(schema.recordingTranscripts.recordingId, recordingId))
    .limit(1);
  return rows.length ? rows[0].removedAt : null;
}
