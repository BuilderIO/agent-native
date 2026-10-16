import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { dispatchPostFinalizeJob } from "./post-finalize-dispatch.js";

export async function reconcileMeetingOnRecordingReady(params: {
  recordingId: string;
  ownerEmail: string;
  endedAtIso: string;
}): Promise<void> {
  const db = getDb();
  const meetings = await db
    .select({
      id: schema.meetings.id,
      actualEnd: schema.meetings.actualEnd,
      summaryMd: schema.meetings.summaryMd,
    })
    .from(schema.meetings)
    .where(
      and(
        eq(schema.meetings.recordingId, params.recordingId),
        eq(schema.meetings.ownerEmail, params.ownerEmail),
        isNull(schema.meetings.trashedAt),
      ),
    );
  if (meetings.length === 0) return;

  for (const meeting of meetings) {
    if (meeting.actualEnd !== null) continue;
    await db
      .update(schema.meetings)
      .set({
        actualEnd: params.endedAtIso,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(schema.meetings.id, meeting.id),
          isNull(schema.meetings.actualEnd),
        ),
      );
  }

  if (!meetings.some((meeting) => meeting.summaryMd === "")) return;

  await dispatchPostFinalizeJob({
    recordingId: params.recordingId,
    kind: "meeting-finalize",
    requireAccepted: true,
  });
}
