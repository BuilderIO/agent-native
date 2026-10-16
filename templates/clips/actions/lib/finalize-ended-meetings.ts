import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { getDb, schema } from "../../server/db/index.js";
import finalizeMeeting from "../finalize-meeting.js";

export async function listEndedMeetingsForRecording(
  db: ReturnType<typeof getDb>,
  recordingId: string,
): Promise<Array<{ id: string }>> {
  // guard:allow-unscoped — callers already authorize the recording, this reads meeting ids only, and finalizeMeeting checks editor access on each meeting before reading its body.
  return db
    .select({ id: schema.meetings.id })
    .from(schema.meetings)
    .where(
      and(
        eq(schema.meetings.recordingId, recordingId),
        isNotNull(schema.meetings.actualEnd),
        inArray(schema.meetings.transcriptStatus, ["ready", "failed"]),
        eq(schema.meetings.summaryMd, ""),
      ),
    );
}

export async function finalizeEndedMeetingsForRecording(
  db: ReturnType<typeof getDb>,
  recordingId: string,
): Promise<void> {
  const meetings = await listEndedMeetingsForRecording(db, recordingId);

  await Promise.all(
    meetings.map(async (meeting) => {
      try {
        await finalizeMeeting.run({ meetingId: meeting.id });
      } catch (error) {
        console.warn(
          `[clips] meeting notes finalization failed for ${meeting.id}:`,
          (error as Error)?.message ?? String(error),
        );
      }
    }),
  );
}
