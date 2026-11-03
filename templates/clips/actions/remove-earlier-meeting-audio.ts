import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNotNull, isNull, like } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { dispatchPostFinalizeJob } from "../server/lib/post-finalize-dispatch.js";
import { assertRecordingNotExpired } from "../server/lib/recording-read-access.js";
import {
  speakerLabeledText,
  withoutEarlierAudio,
} from "../shared/earlier-audio.js";
import { readSegmentEntries } from "../shared/transcript-segments.js";
import finalizeMeeting from "./finalize-meeting.js";
import { listEndedMeetingsForRecording } from "./lib/finalize-ended-meetings.js";

const removalResultSchema = z.object({
  meetingId: z.string(),
  removedSegments: z.number(),
  notes: z.enum([
    "regenerated",
    "regenerating",
    "failed",
    "live",
    "empty",
    "unchanged",
  ]),
});

function unreadableTranscript(): never {
  fail("The transcript couldn't be read, so nothing was removed.", {
    errorCode: "transcript_unreadable",
    statusCode: 409,
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function logDispatchFailure(recordingId: string, err: unknown) {
  console.warn(
    `[clips] post-removal dispatch failed for ${recordingId}:`,
    errorMessage(err),
  );
}

export default defineAction({
  description:
    "Remove the audio recovered from before the user started recording from a meeting. Takes its segments out of the transcript and its saved versions, clears the notes built from it, and rebuilds the notes and the linked Clip's generated title and description from what remains; a hand-written description is replaced too because descriptions don't record their source. `notes` reports the outcome: `regenerated`, `regenerating`, `failed` (run finalize-meeting with force to retry), `live` (notes build when the meeting ends), `empty` (no transcript remains), or `unchanged` (no earlier audio). A running capture can't add it back. Editor access to the meeting and its recording required.",
  schema: z.object({
    meetingId: z.string().describe("Meeting id"),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  outputSchema: removalResultSchema,
  run: async ({ meetingId }): Promise<z.infer<typeof removalResultSchema>> => {
    await assertAccess("meeting", meetingId, "editor");
    const db = getDb();
    const meetings = await db
      .select({
        title: schema.meetings.title,
        recordingId: schema.meetings.recordingId,
        actualEnd: schema.meetings.actualEnd,
      })
      .from(schema.meetings)
      .where(
        and(
          eq(schema.meetings.id, meetingId),
          isNull(schema.meetings.trashedAt),
        ),
      )
      .limit(1);
    if (meetings.length === 0) {
      fail(`Meeting not found: ${meetingId}`, {
        errorCode: "meeting_not_found",
        statusCode: 404,
      });
    }
    const [meeting] = meetings;
    const unchanged = {
      meetingId,
      removedSegments: 0,
      notes: "unchanged" as const,
    };
    const { recordingId } = meeting;
    if (!recordingId) return unchanged;
    assertRecordingNotExpired(
      await assertAccess("recording", recordingId, "editor"),
    );

    const now = new Date().toISOString();
    // save-browser-transcript locks the same recording row, so a capture flush
    // lands either before this removal or after its stamp is visible.
    const removal = await db.transaction(async (tx) => {
      const recordings = await tx
        .select({
          status: schema.recordings.status,
          titleSource: schema.recordings.titleSource,
        })
        .from(schema.recordings)
        .where(eq(schema.recordings.id, recordingId))
        .for("update");
      const transcripts = await tx
        .select({ segmentsJson: schema.recordingTranscripts.segmentsJson })
        .from(schema.recordingTranscripts)
        .where(eq(schema.recordingTranscripts.recordingId, recordingId))
        .limit(1);
      if (recordings.length === 0 || transcripts.length === 0) return null;
      const [recording] = recordings;
      const [transcript] = transcripts;

      const entries = readSegmentEntries(transcript.segmentsJson);
      if (!entries) unreadableTranscript();
      const kept = withoutEarlierAudio(entries);
      const removedSegments = entries.length - kept.length;
      if (removedSegments === 0) return null;

      const fullText = speakerLabeledText(kept);
      await tx
        .update(schema.recordingTranscripts)
        .set({
          segmentsJson: JSON.stringify(kept),
          fullText,
          earlierAudioRemovedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.recordingTranscripts.recordingId, recordingId));

      const v = schema.recordingTranscriptVersions;
      const versions = await tx
        .select({ id: v.id, segmentsJson: v.segmentsJson })
        .from(v)
        .where(
          and(
            eq(v.recordingId, recordingId),
            like(v.segmentsJson, '%"recovered":true%'),
          ),
        );
      for (const version of versions) {
        const versionEntries = readSegmentEntries(version.segmentsJson);
        if (!versionEntries) unreadableTranscript();
        const versionKept = withoutEarlierAudio(versionEntries);
        await tx
          .update(v)
          .set({
            segmentsJson: JSON.stringify(versionKept),
            fullText: speakerLabeledText(versionKept),
          })
          .where(eq(v.id, version.id));
      }

      // Every ended meeting on this recording built its notes from this
      // transcript, including one in the trash that could be restored later.
      const clearedMeetings = await tx
        .update(schema.meetings)
        .set({
          summaryMd: "",
          bulletsJson: "[]",
          actionItemsJson: "[]",
          transcriptStatus: "ready",
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.meetings.recordingId, recordingId),
            isNotNull(schema.meetings.actualEnd),
          ),
        )
        .returning({ id: schema.meetings.id });
      if (clearedMeetings.length) {
        await tx.delete(schema.meetingActionItems).where(
          inArray(
            schema.meetingActionItems.meetingId,
            clearedMeetings.map((cleared) => cleared.id),
          ),
        );
      }

      // Finalize feeds the Clip's description back in as context, so keeping
      // it would carry the removed audio into the rebuilt summary.
      await tx
        .update(schema.recordings)
        .set({
          description: "",
          ...(recording.titleSource === "ai"
            ? { title: meeting.title, titleSource: "default" as const }
            : {}),
          updatedAt: now,
        })
        .where(eq(schema.recordings.id, recordingId));

      return { removedSegments, fullText, recordingStatus: recording.status };
    });
    if (!removal) return unchanged;

    await writeAppState("refresh-signal", { ts: Date.now() });

    const { removedSegments, fullText, recordingStatus } = removal;
    if (!fullText) return { meetingId, removedSegments, notes: "empty" };
    if (recordingStatus === "ready") {
      await dispatchPostFinalizeJob({ recordingId, kind: "transcript" }).catch(
        (err: unknown) => logDispatchFailure(recordingId, err),
      );
    }
    if (!meeting.actualEnd) {
      return { meetingId, removedSegments, notes: "live" };
    }

    // The job covers other meetings on this recording and retries this one if
    // the run below dies. The delay lets that run claim the meeting first.
    if ((await listEndedMeetingsForRecording(db, recordingId)).length) {
      await dispatchPostFinalizeJob({
        recordingId,
        kind: "meeting-finalize",
        delayMs: 30_000,
      }).catch((err: unknown) => logDispatchFailure(recordingId, err));
    }
    try {
      const result = await finalizeMeeting.run({ meetingId, force: true });
      return {
        meetingId,
        removedSegments,
        notes: "skipped" in result ? "regenerating" : "regenerated",
      };
    } catch (err) {
      console.warn(
        `[clips] notes rebuild failed after removing earlier audio from ${meetingId}:`,
        errorMessage(err),
      );
      return { meetingId, removedSegments, notes: "failed" };
    }
  },
});
