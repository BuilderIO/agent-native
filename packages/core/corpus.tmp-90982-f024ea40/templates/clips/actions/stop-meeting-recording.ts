/**
 * Stop a meeting recording.
 *
 * Stamps the meeting's `actualEnd`, flips a still-`uploading` recording to
 * `ready`, writes a `recording-stop-*` app-state signal so the recorder UI
 * finalizes, and bumps the refresh signal.
 *
 * The actual MediaRecorder stop and chunked-upload finalize are UI gestures.
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Stop a meeting recording. Stamps actualEnd on the meeting, marks the linked recording 'ready' (if still uploading), and signals the UI to finalize the underlying recording.",
  schema: z.object({
    meetingId: z.string().describe("Meeting id"),
  }),
  run: async (args) => {
    await assertAccess("meeting", args.meetingId, "editor");
    const db = getDb();
    const nowIso = new Date().toISOString();

    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.id, args.meetingId))
      .limit(1);
    if (!meeting) throw new Error(`Meeting not found: ${args.meetingId}`);

    // Only mark the transcript "ready" if a transcript actually exists —
    // otherwise finalize-meeting has nothing to summarize and there would be
    // no way for the UI to distinguish "notes coming" from "nothing was ever
    // captured". Match finalize-meeting's own empty-transcript handling.
    let hasTranscript = false;
    if (meeting.recordingId) {
      const [transcript] = await db
        .select({ fullText: schema.recordingTranscripts.fullText })
        .from(schema.recordingTranscripts)
        .where(eq(schema.recordingTranscripts.recordingId, meeting.recordingId))
        .limit(1);
      hasTranscript = Boolean(transcript?.fullText?.trim());
    }

    await db
      .update(schema.meetings)
      .set({
        actualEnd: meeting.actualEnd ?? nowIso,
        updatedAt: nowIso,
        transcriptStatus: hasTranscript ? "ready" : "failed",
      })
      .where(eq(schema.meetings.id, args.meetingId));

    if (meeting.recordingId) {
      await db
        .update(schema.recordings)
        .set({ status: "ready", updatedAt: nowIso })
        .where(
          and(
            eq(schema.recordings.id, meeting.recordingId),
            eq(schema.recordings.status, "uploading"),
          ),
        );

      await writeAppState(`recording-stop-${meeting.recordingId}`, {
        recordingId: meeting.recordingId,
        meetingId: args.meetingId,
        requestedAt: nowIso,
      });
    }
    await writeAppState("refresh-signal", { ts: Date.now() });

    return { meetingId: args.meetingId, recordingId: meeting.recordingId };
  },
});
