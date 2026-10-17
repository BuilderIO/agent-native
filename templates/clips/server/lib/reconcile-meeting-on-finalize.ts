import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

export async function reconcileMeetingOnRecordingReady(params: {
  recordingId: string;
  ownerEmail: string;
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
