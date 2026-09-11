/**
 * When a meeting-linked recording finishes uploading, the linked meeting can
 * still show "Live" for up to 5 minutes (until the next stale-meeting-sweeper
 * tick) even though the recording is done. Stamp `actualEnd` here too, in the
 * same request, so the meeting detail page stops polling immediately instead
 * of waiting on the sweeper backstop.
 *
 * `meetings.recordingId` is the only FK between the two tables (see the
 * `meetings` skill) — there is no `recordings.meeting_id` column — so this
 * looks the link up in that direction.
 */

import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

export async function reconcileMeetingOnRecordingReady(params: {
  recordingId: string;
  ownerEmail: string;
  /** ISO timestamp to stamp as actualEnd — pass the recording's own finalize
   * timestamp so this doesn't drift from when the recording actually ended. */
  endedAtIso: string;
}): Promise<void> {
  const db = getDb();
  const [meeting] = await db
    .select({ id: schema.meetings.id })
    .from(schema.meetings)
    .where(
      and(
        eq(schema.meetings.recordingId, params.recordingId),
        eq(schema.meetings.ownerEmail, params.ownerEmail),
        isNull(schema.meetings.actualEnd),
        isNull(schema.meetings.trashedAt),
      ),
    )
    .limit(1);
  if (!meeting) return;

  await db
    .update(schema.meetings)
    .set({ actualEnd: params.endedAtIso, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(schema.meetings.id, meeting.id),
        isNull(schema.meetings.actualEnd),
      ),
    );
}
