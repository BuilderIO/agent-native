/**
 * Email notifications for Activity events (comments, replies, reactions).
 *
 * Recipient resolution and delivery reporting live in
 * `@agent-native/core/server`; this module only knows which Clips rows are
 * involved and which template to render. Share invites are deliberately NOT
 * routed through the Clips notification preferences - they have their own
 * delivery path.
 */

import {
  notifyActivity,
  runActivityNotification,
  type ActivityNotificationResult,
} from "@agent-native/core/server";
import { filterRecipientsByResourceAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";

import { CLIPS_USER_PREFS_KEY } from "../../shared/clips-ai-prefs.js";
import { getDb, schema } from "../db/index.js";
import { filterClipsNotificationRecipients } from "./notification-preferences.js";
import { canReceiveRecordingActivity } from "./recording-page-access.js";
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
      orgId: schema.recordings.orgId,
      password: schema.recordings.password,
      expiresAt: schema.recordings.expiresAt,
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

export interface RecordingCommentNotificationInput {
  recordingId: string;
  threadId: string;
  authorEmail: string;
  authorName?: string | null;
  content: string;
  mentions?: { email: string; name: string }[];
  videoTimestampMs?: number | null;
  isReply?: boolean;
}

export async function notifyRecordingComment(
  input: RecordingCommentNotificationInput,
): Promise<ClipsActivityNotificationResult> {
  return runActivityNotification(LOG_LABEL, () =>
    deliverRecordingCommentEmails(input),
  );
}

async function deliverRecordingCommentEmails(
  input: RecordingCommentNotificationInput,
): Promise<ClipsActivityNotificationResult> {
  const recording = await getRecording(input.recordingId);
  if (!recording) {
    console.error(`${LOG_LABEL}: recording ${input.recordingId} not found`);
    return RECORDING_MISSING;
  }

  const mentions = input.mentions ?? [];
  const mentioned = new Set(
    mentions.map((mention) => mention.email.trim().toLowerCase()),
  );
  const candidates = [recording.ownerEmail, ...mentioned];
  if (input.isReply) {
    candidates.push(
      ...(await threadParticipants(input.recordingId, input.threadId)),
    );
  }

  // Thread rows are history, not an access grant: a viewer whose share was
  // revoked must stop receiving the recording's comment bodies.
  const clipsAllowed = candidates.filter((email) =>
    canReceiveRecordingActivity({
      ownerEmail: recording.ownerEmail,
      recipientEmail: email,
      hasPassword: Boolean(recording.password),
      expiresAt: recording.expiresAt,
    }),
  );
  const allowed = await filterRecipientsByResourceAccess({
    resourceType: "recording",
    resourceId: recording.id,
    emails: clipsAllowed,
    orgId: recording.orgId,
  });
  const recipients = await filterClipsNotificationRecipients(
    allowed,
    "comments",
  );

  return notifyActivity({
    candidates: recipients,
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
        ...(mentioned.has(to) ? { wasMentioned: true } : {}),
      }),
  });
}

export interface RecordingReactionNotificationInput {
  recordingId: string;
  emoji: string;
  viewerEmail: string;
  viewerName?: string | null;
  videoTimestampMs?: number | null;
  extraRecipients?: (string | null | undefined)[];
}

export async function notifyRecordingReaction(
  input: RecordingReactionNotificationInput,
): Promise<ClipsActivityNotificationResult> {
  return runActivityNotification(LOG_LABEL, () =>
    deliverRecordingReactionEmails(input),
  );
}

async function deliverRecordingReactionEmails(
  input: RecordingReactionNotificationInput,
): Promise<ClipsActivityNotificationResult> {
  const recording = await getRecording(input.recordingId);
  if (!recording) {
    console.error(`${LOG_LABEL}: recording ${input.recordingId} not found`);
    return RECORDING_MISSING;
  }

  const clipsAllowed = [recording.ownerEmail, ...(input.extraRecipients ?? [])]
    .filter((email): email is string => Boolean(email))
    .filter((email) =>
      canReceiveRecordingActivity({
        ownerEmail: recording.ownerEmail,
        recipientEmail: email,
        hasPassword: Boolean(recording.password),
        expiresAt: recording.expiresAt,
      }),
    );
  const allowed = await filterRecipientsByResourceAccess({
    resourceType: "recording",
    resourceId: recording.id,
    emails: clipsAllowed,
    orgId: recording.orgId,
  });
  const recipients = await filterClipsNotificationRecipients(
    allowed,
    "reactions",
  );

  return notifyActivity({
    candidates: recipients,
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
