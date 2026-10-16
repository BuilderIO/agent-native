import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { dispatchPostFinalizeJob } from "../server/lib/post-finalize-dispatch.js";
import {
  meetingTranscriptText,
  parseTranscriptSegments,
} from "../shared/transcript-segments.js";

// A live session re-saves the whole transcript every few seconds, so the
// removal compares against the row it read and retries on a newer save.
const MAX_ATTEMPTS = 3;

export default defineAction({
  description:
    "Remove the audio from before meeting notes started that Rewind added to a meeting's transcript. Drops those transcript segments, clears the notes summary, bullets, action items and the Clip summary written from them, and queues them to be written again from what is left. Editor access required.",
  schema: z.object({
    meetingId: z.string().describe("Meeting id"),
  }),
  run: async (args) => {
    await assertAccess("meeting", args.meetingId, "editor");
    const db = getDb();

    const [meeting] = await db
      .select({
        recordingId: schema.meetings.recordingId,
        actualEnd: schema.meetings.actualEnd,
      })
      .from(schema.meetings)
      .where(eq(schema.meetings.id, args.meetingId))
      .limit(1);
    if (!meeting) {
      fail(`Meeting not found: ${args.meetingId}`, {
        errorCode: "meeting_not_found",
        statusCode: 404,
      });
    }
    const recordingId = meeting.recordingId;
    if (!recordingId) {
      fail("This meeting has no transcript.", {
        errorCode: "no_earlier_audio",
        statusCode: 409,
      });
    }
    await assertAccess("recording", recordingId, "editor");

    const t = schema.recordingTranscripts;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const [transcript] = await db
        .select({
          segmentsJson: t.segmentsJson,
          updatedAt: t.updatedAt,
          earlierAudioMs: t.earlierAudioMs,
          earlierAudioRemovedAt: t.earlierAudioRemovedAt,
        })
        .from(t)
        .where(eq(t.recordingId, recordingId))
        .limit(1);
      if (transcript?.earlierAudioRemovedAt) {
        return {
          meetingId: args.meetingId,
          recordingId,
          status: "already-removed" as const,
        };
      }
      if (!transcript?.earlierAudioMs) {
        fail("This meeting has no audio from before notes started.", {
          errorCode: "no_earlier_audio",
          statusCode: 409,
        });
      }

      const segments = parseTranscriptSegments(transcript.segmentsJson);
      const kept = segments.filter((segment) => !segment.earlier);
      const fullText = meetingTranscriptText(kept);
      const ended = Boolean(meeting.actualEnd);
      const now = new Date().toISOString();

      const removed = await db.transaction(async (tx) => {
        const written = await tx
          .update(t)
          .set({
            segmentsJson: JSON.stringify(kept),
            fullText,
            earlierAudioRemovedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(t.recordingId, recordingId),
              eq(t.updatedAt, transcript.updatedAt),
              isNull(t.earlierAudioRemovedAt),
            ),
          )
          .returning({ recordingId: t.recordingId });
        if (!written.length) return false;

        // Everything written from the old transcript goes, so none of the
        // removed audio survives a failed rewrite. Setting the status also
        // voids a finalize still running on the old text: its write
        // requires "pending".
        await tx
          .update(schema.meetings)
          .set({
            summaryMd: "",
            bulletsJson: "[]",
            actionItemsJson: "[]",
            ...(ended
              ? { transcriptStatus: fullText ? "ready" : "failed" }
              : {}),
            updatedAt: now,
          })
          .where(eq(schema.meetings.id, args.meetingId));
        await tx
          .delete(schema.meetingActionItems)
          .where(eq(schema.meetingActionItems.meetingId, args.meetingId));
        // An AI title may quote the removed audio; "default" lets the
        // transcript job write a new one.
        await tx
          .update(schema.recordings)
          .set({
            description: "",
            titleSource: sql`case when ${schema.recordings.titleSource} = 'ai' then 'default' else ${schema.recordings.titleSource} end`,
            updatedAt: now,
          })
          .where(eq(schema.recordings.id, recordingId));
        return true;
      });
      if (!removed) continue;

      await writeAppState("refresh-signal", { ts: Date.now() });

      // The transcript job writes the title, Clip summary and meeting notes
      // again, then refreshes the Brain export. A live meeting gets them
      // when it ends.
      let followUp:
        | "queued"
        | "after-meeting-ends"
        | "nothing-left"
        | "failed" = ended
        ? fullText
          ? "queued"
          : "nothing-left"
        : "after-meeting-ends";
      if (followUp === "queued") {
        try {
          await dispatchPostFinalizeJob({ recordingId, kind: "transcript" });
        } catch (err) {
          console.warn(
            `[clips] notes rewrite dispatch failed after removing earlier audio for ${recordingId}:`,
            (err as Error)?.message ?? String(err),
          );
          followUp = "failed";
        }
      }

      return {
        meetingId: args.meetingId,
        recordingId,
        status: "removed" as const,
        removedSegments: segments.length - kept.length,
        followUp,
      };
    }

    fail(
      "The transcript kept changing while removing the earlier audio. Try again.",
      { errorCode: "transcript_busy", statusCode: 409 },
    );
  },
});
