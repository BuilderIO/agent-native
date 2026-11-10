import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { recordingExpiryQuery } from "./recording-expiry-query.js";
import { canReceiveRecordingActivity } from "./recording-page-access.js";
import { ownerEmailMatches } from "./recordings.js";

type RecordingReference = Pick<
  typeof schema.recordings.$inferSelect,
  "id" | "title" | "status" | "durationMs"
>;
type LinkedMeeting = {
  recordingId: string | null;
  shareTranscript?: boolean | null;
};

export function meetingRecordingReference(recording: RecordingReference) {
  return {
    id: recording.id,
    title: recording.title,
    status: recording.status,
    durationMs: recording.durationMs,
  };
}

export function isMeetingRecordingAvailable(
  recording: {
    ownerEmail: string;
    expiresAt?: string | null;
    trashedAt?: string | null;
    failureCode?: string | null;
    hasPassword: boolean;
  },
  viewerEmail: string | undefined,
) {
  return (
    recording.failureCode !== "taken_down" &&
    canReceiveRecordingActivity({
      ...recording,
      recipientEmail: viewerEmail ?? "",
    })
  );
}

export async function loadMeetingRecordingContent(
  meeting: LinkedMeeting,
  viewerEmail: string | undefined,
) {
  const db = getDb();
  const sources = meeting.recordingId
    ? await db
        .select({
          id: schema.recordings.id,
          title: schema.recordings.title,
          status: schema.recordings.status,
          durationMs: schema.recordings.durationMs,
          ownerEmail: schema.recordings.ownerEmail,
          expiresAt: schema.recordings.expiresAt,
          trashedAt: schema.recordings.trashedAt,
          failureCode: schema.recordings.failureCode,
          hasPassword: sql<boolean>`nullif(${schema.recordings.password}, '') is not null`,
        })
        .from(schema.recordings)
        .where(eq(schema.recordings.id, meeting.recordingId))
        .limit(1)
    : [];
  const source = sources.values().next().value;
  const available = Boolean(
    source && isMeetingRecordingAvailable(source, viewerEmail),
  );
  const access =
    available && viewerEmail && source
      ? await resolveAccess("recording", source.id)
      : null;
  const canReadRecording = available && Boolean(access);
  // Sharing a meeting transcript does not share the linked Clip or bypass its protections.
  const canReadTranscript =
    available && (canReadRecording || meeting.shareTranscript === true);
  const transcripts =
    canReadTranscript && source
      ? await db
          .select({
            status: schema.recordingTranscripts.status,
            language: schema.recordingTranscripts.language,
            fullText: schema.recordingTranscripts.fullText,
            segmentsJson: schema.recordingTranscripts.segmentsJson,
            updatedAt: schema.recordingTranscripts.updatedAt,
          })
          .from(schema.recordingTranscripts)
          .where(eq(schema.recordingTranscripts.recordingId, source.id))
          .limit(1)
      : [];
  const transcript = transcripts.values().next().value;
  return {
    sourcePresent: Boolean(source),
    canReadRecording,
    canReadTranscript,
    recording:
      canReadRecording && source ? meetingRecordingReference(source) : null,
    transcript: transcript ?? null,
  };
}

export function meetingRecordingTranscriptFilter(
  viewerEmail: string | undefined,
) {
  const owner = viewerEmail
    ? ownerEmailMatches(schema.recordings.ownerEmail, viewerEmail)
    : sql`false`;
  return and(
    recordingExpiryQuery(viewerEmail).available,
    or(owner, sql`nullif(${schema.recordings.trashedAt}, '') is null`),
    or(owner, sql`nullif(${schema.recordings.password}, '') is null`),
    or(
      isNull(schema.recordings.failureCode),
      ne(schema.recordings.failureCode, "taken_down"),
    ),
    or(
      eq(schema.meetings.shareTranscript, true),
      accessFilter(
        schema.recordings,
        schema.recordingShares,
        undefined,
        "viewer",
        { includePublic: true },
      ),
    ),
  );
}
