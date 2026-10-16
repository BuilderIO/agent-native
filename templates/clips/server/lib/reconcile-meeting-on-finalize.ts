import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { dispatchPostFinalizeJob } from "./post-finalize-dispatch.js";

async function findLinkedMeetings(params: {
  recordingId: string;
  ownerEmail: string;
}) {
  const db = getDb();
  return db
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
}

async function dispatchMeetingFinalizationIfPending(
  recordingId: string,
  meetings: Array<{ actualEnd: string | null; summaryMd: string }>,
  includeUnendedMeetings = false,
) {
  if (
    !meetings.some(
      (meeting) =>
        (includeUnendedMeetings || meeting.actualEnd !== null) &&
        meeting.summaryMd === "",
    )
  ) {
    return;
  }

  await dispatchPostFinalizeJob({
    recordingId,
    kind: "meeting-finalize",
    requireAccepted: true,
  });
}

export async function reconcileMeetingOnRecordingReady(params: {
  recordingId: string;
  ownerEmail: string;
  endedAtIso: string;
}): Promise<void> {
  const db = getDb();
  const meetings = await findLinkedMeetings(params);
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
          eq(schema.meetings.ownerEmail, params.ownerEmail),
          isNull(schema.meetings.actualEnd),
        ),
      );
  }

  await dispatchMeetingFinalizationIfPending(
    params.recordingId,
    meetings,
    true,
  );
}

export async function reconcileMeetingOnRecordingFailed(params: {
  recordingId: string;
  ownerEmail: string;
}): Promise<void> {
  const meetings = await findLinkedMeetings(params);
  await dispatchMeetingFinalizationIfPending(params.recordingId, meetings);
}
