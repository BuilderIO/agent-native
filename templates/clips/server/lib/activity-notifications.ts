/**
 * Email notifications for Activity events (comments, replies, reactions).
 *
 * Recipient resolution and delivery reporting live in
 * `@agent-native/core/server`; this module only knows which Clips rows are
 * involved and which template to render. Share invites are deliberately NOT
 * routed through the `emailNotifications` preference — they have their own
 * delivery path.
 */

import {
  notifyActivity,
  type ActivityNotificationResult,
} from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";

import { CLIPS_USER_PREFS_KEY } from "../../shared/clips-ai-prefs.js";
import { getDb, schema } from "../db/index.js";
import { sendClipsTransactionalEmail } from "./transactional-email-templates.js";

/**
 * `recording-missing` is kept distinct from `no-recipients`: one means the row
 * we were asked to notify about could not be read, the other means nobody
 * wanted the email.
 */
export type ClipsActivityNotificationResult =
  | ActivityNotificationResult
  | { status: "recording-missing"; sent: []; failed: [] };

const RECORDING_MISSING: ClipsActivityNotificationResult = {
  status: "recording-missing",
  sent: [],
  failed: [],
};

const LOG_LABEL = "[clips] activity notification";

async function getRecording(recordingId: string) {
  const [row] = await getDb()
    .select({
      id: schema.recordings.id,
      title: schema.recordings.title,
      ownerEmail: schema.recordings.ownerEmail,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, recordingId))
    .limit(1);
  return row ?? null;
}

async function threadParticipants(
  recordingId: string,
  threadId: string,
): Promise<string[]> {
  const rows = await getDb()
    .select({ authorEmail: schema.recordingComments.authorEmail })
    .from(schema.recordingComments)
    .where(
      and(
        eq(schema.recordingComments.recordingId, recordingId),
        eq(schema.recordingComments.threadId, threadId),
      ),
    );
  return rows.map((row) => row.authorEmail);
}

export async function notifyRecordingComment(input: {
  recordingId: string;
  threadId: string;
  authorEmail: string;
  authorName?: string | null;
  content: string;
  videoTimestampMs?: number | null;
  isReply?: boolean;
}): Promise<ClipsActivityNotificationResult> {
  const recording = await getRecording(input.recordingId);
  if (!recording) {
    console.error(`${LOG_LABEL}: recording ${input.recordingId} not found`);
    return RECORDING_MISSING;
  }

  const candidates = [recording.ownerEmail];
  if (input.isReply) {
    candidates.push(
      ...(await threadParticipants(input.recordingId, input.threadId)),
    );
  }

  return notifyActivity({
    candidates,
    actorEmail: input.authorEmail,
    preferenceKey: CLIPS_USER_PREFS_KEY,
    logLabel: LOG_LABEL,
    send: (to) =>
      sendClipsTransactionalEmail({
        kind: "activity-comment",
        to,
        recordingId: recording.id,
        title: recording.title,
        authorEmail: input.authorEmail,
        authorName: input.authorName ?? null,
        content: input.content,
        videoTimestampMs: input.videoTimestampMs ?? null,
        isReply: input.isReply ?? false,
      }),
  });
}

export async function notifyRecordingReaction(input: {
  recordingId: string;
  emoji: string;
  viewerEmail: string;
  viewerName?: string | null;
  videoTimestampMs?: number | null;
  extraRecipients?: (string | null | undefined)[];
}): Promise<ClipsActivityNotificationResult> {
  const recording = await getRecording(input.recordingId);
  if (!recording) {
    console.error(`${LOG_LABEL}: recording ${input.recordingId} not found`);
    return RECORDING_MISSING;
  }

  return notifyActivity({
    candidates: [recording.ownerEmail, ...(input.extraRecipients ?? [])],
    actorEmail: input.viewerEmail,
    preferenceKey: CLIPS_USER_PREFS_KEY,
    logLabel: LOG_LABEL,
    send: (to) =>
      sendClipsTransactionalEmail({
        kind: "activity-reaction",
        to,
        recordingId: recording.id,
        title: recording.title,
        emoji: input.emoji,
        authorEmail: input.viewerEmail,
        authorName: input.viewerName ?? null,
        videoTimestampMs: input.videoTimestampMs ?? null,
      }),
  });
}
