import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { getDb, schema } from "../../server/db/index.js";
import finalizeMeeting from "../finalize-meeting.js";

class RetryableMeetingFinalizationError extends Error {
  constructor(
    message: string,
    readonly failures: unknown[] = [],
  ) {
    super(message);
    this.name = "RetryableMeetingFinalizationError";
  }
}

export async function listEndedMeetingsForRecording(
  db: ReturnType<typeof getDb>,
  recordingId: string,
  options: { includePending?: boolean } = {},
): Promise<Array<{ id: string }>> {
  // guard:allow-unscoped — callers already authorize the recording, this reads meeting ids only, and finalizeMeeting checks editor access on each meeting before reading its body.
  const transcriptStatuses = options.includePending
    ? (["ready", "failed", "pending"] as const)
    : (["ready", "failed"] as const);
  return db
    .select({ id: schema.meetings.id })
    .from(schema.meetings)
    .where(
      and(
        eq(schema.meetings.recordingId, recordingId),
        isNotNull(schema.meetings.actualEnd),
        inArray(schema.meetings.transcriptStatus, transcriptStatuses),
        eq(schema.meetings.summaryMd, ""),
      ),
    );
}

export async function finalizeEndedMeetingsForRecording(
  db: ReturnType<typeof getDb>,
  recordingId: string,
  options: { throwOnFailure?: boolean } = {},
): Promise<void> {
  const meetings = await listEndedMeetingsForRecording(db, recordingId, {
    includePending: options.throwOnFailure,
  });
  const failures: unknown[] = [];

  await Promise.all(
    meetings.map(async (meeting) => {
      try {
        const result = await finalizeMeeting.run({
          meetingId: meeting.id,
          ...(options.throwOnFailure ? { force: true } : {}),
        });
        if (
          options.throwOnFailure &&
          typeof result === "object" &&
          result !== null &&
          "skipped" in result
        ) {
          throw new RetryableMeetingFinalizationError(
            `Meeting ${meeting.id} finalization was skipped: ${String(result.skipped)}`,
          );
        }
      } catch (error) {
        console.warn(
          `[clips] meeting notes finalization failed for ${meeting.id}:`,
          (error as Error)?.message ?? String(error),
        );
        failures.push(error);
      }
    }),
  );

  if (options.throwOnFailure && failures.length > 0) {
    throw new RetryableMeetingFinalizationError(
      `Failed to finalize ${failures.length} ended meeting(s) for recording ${recordingId}`,
      failures,
    );
  }
}
