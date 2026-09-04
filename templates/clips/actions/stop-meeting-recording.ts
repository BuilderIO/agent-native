/**
 * Stop a meeting recording.
 *
 * Stamps the meeting's `actualEnd`, flips a still-`uploading` recording to
 * `ready`, writes a `recording-stop-*` app-state signal so the recorder UI
 * finalizes, and bumps the refresh signal.
 *
 * The actual MediaRecorder stop and chunked-upload finalize are UI gestures.
 */

import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import shareResource from "@agent-native/core/sharing/actions/share-resource";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { normalizeOwnerEmail } from "../server/lib/recordings.js";

type ShareableResourceType = "meeting" | "recording";

async function sharePublicMeetingResourcesWithParticipants(args: {
  meetingId: string;
  recordingId: string | null;
  recordingVisibility: string | null | undefined;
  ownerEmail: string;
  participants: Array<{ email: string }>;
}) {
  const ownerEmail = normalizeOwnerEmail(args.ownerEmail);
  const participantEmails = [
    ...new Set(
      args.participants
        .map((participant) => normalizeOwnerEmail(participant.email))
        .filter((email) => email && email !== ownerEmail),
    ),
  ];
  if (!participantEmails.length) return;

  const resources: Array<{
    resourceType: ShareableResourceType;
    resourceId: string;
  }> = [
    { resourceType: "meeting", resourceId: args.meetingId },
    ...(args.recordingId && args.recordingVisibility === "public"
      ? [{ resourceType: "recording" as const, resourceId: args.recordingId }]
      : []),
  ];

  await Promise.all(
    resources.flatMap(({ resourceType, resourceId }) =>
      participantEmails.map((principalId) =>
        Promise.resolve(
          shareResource.run({
            resourceType,
            resourceId,
            principalType: "user",
            principalId,
            role: "viewer",
            notify: false,
          }),
        ),
      ),
    ),
  );
}

export default defineAction({
  description:
    "Stop a meeting recording. Stamps actualEnd on the meeting, marks the linked recording 'ready' (if still uploading), and signals the UI to finalize the underlying recording.",
  schema: z.object({
    meetingId: z.string().describe("Meeting id"),
    reason: z
      .string()
      .trim()
      .max(64)
      .optional()
      .describe(
        "Why the recording stopped, e.g. 'manual' or a native detector name. Omit to leave end_reason untouched.",
      ),
  }),
  run: async (args) => {
    const access = await assertAccess("meeting", args.meetingId, "editor");
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
    let recordingVisibility: string | null | undefined;
    if (meeting.recordingId) {
      const [transcriptRows, recordingRows] = await Promise.all([
        db
          .select({ fullText: schema.recordingTranscripts.fullText })
          .from(schema.recordingTranscripts)
          .where(
            eq(schema.recordingTranscripts.recordingId, meeting.recordingId),
          )
          .limit(1),
        db
          .select({ visibility: schema.recordings.visibility })
          .from(schema.recordings)
          .where(eq(schema.recordings.id, meeting.recordingId))
          .limit(1),
      ]);
      const transcript = transcriptRows[0];
      recordingVisibility = recordingRows[0]?.visibility;
      hasTranscript = Boolean(transcript?.fullText?.trim());
    }

    // actualEnd is a first-write-wins field (a second stop is a no-op on it),
    // so endReason only stamps alongside the write that actually sets it —
    // a later call with a reason must not overwrite the original cause.
    const isFirstStop = !meeting.actualEnd;

    await db
      .update(schema.meetings)
      .set({
        actualEnd: meeting.actualEnd ?? nowIso,
        updatedAt: nowIso,
        transcriptStatus: hasTranscript ? "ready" : "failed",
        ...(isFirstStop && args.reason ? { endReason: args.reason } : {}),
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

    // Public resources are intentionally link-only and therefore stay out of
    // the signed-in Meetings/Shared lists. Calendar participants are the one
    // known audience we can safely admit without making every public meeting
    // discoverable, so grant them standard viewer access when the call ends.
    if (
      meeting.visibility === "public" &&
      (access.role === "owner" || access.role === "admin")
    ) {
      const participants = await db
        .select({ email: schema.meetingParticipants.email })
        .from(schema.meetingParticipants)
        .where(eq(schema.meetingParticipants.meetingId, args.meetingId));
      await sharePublicMeetingResourcesWithParticipants({
        meetingId: args.meetingId,
        recordingId: meeting.recordingId ?? null,
        recordingVisibility,
        ownerEmail: meeting.ownerEmail,
        participants,
      });
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    return { meetingId: args.meetingId, recordingId: meeting.recordingId };
  },
});
