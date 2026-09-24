import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { getDb, schema } from "../../server/db/index.js";
import finalizeMeeting from "../finalize-meeting.js";

/** Finalize meeting notes once a linked recording's transcript is ready. */
export async function finalizeEndedMeetingsForRecording(
  db: ReturnType<typeof getDb>,
  recordingId: string,
): Promise<void> {
  const meetings = await db
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

  await Promise.all(
    meetings.map(async (meeting) => {
      try {
        await finalizeMeeting.run({ meetingId: meeting.id });
      } catch (error) {
        // Transcript delivery must remain successful even when the separate
        // notes model is unavailable; a later transcript retry can try again.
        console.warn(
          `[clips] meeting notes finalization failed for ${meeting.id}:`,
          (error as Error)?.message ?? String(error),
        );
      }
    }),
  );
}
