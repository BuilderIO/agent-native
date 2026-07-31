/**
 * Email notifications for Activity events (comments, replies, reactions).
 *
 * Recipients are resolved from the recording owner plus the other humans in a
 * comment thread, then filtered by each recipient's `emailNotifications`
 * preference. Share invites are deliberately NOT routed through this
 * preference — they have their own delivery path.
 */

import { isEmailConfigured } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { and, eq } from "drizzle-orm";

import {
  CLIPS_USER_PREFS_KEY,
  type ClipsUserPrefs,
} from "../../shared/clips-ai-prefs.js";
import { getDb, schema } from "../db/index.js";
import { sendClipsTransactionalEmail } from "./transactional-email-templates.js";

export type ActivityNotificationResult = {
  sent: string[];
  failed: { email: string; error: string }[];
};

const EMPTY_RESULT: ActivityNotificationResult = { sent: [], failed: [] };

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

async function wantsEmailNotifications(email: string): Promise<boolean> {
  const prefs = ((await getUserSetting(email, CLIPS_USER_PREFS_KEY)) ??
    {}) as ClipsUserPrefs;
  return prefs.emailNotifications !== false;
}

async function recipientsFor(
  candidates: (string | null | undefined)[],
  actorEmail: string | null | undefined,
): Promise<string[]> {
  const actor = normalizeEmail(actorEmail);
  const unique = new Set<string>();
  for (const candidate of candidates) {
    const email = normalizeEmail(candidate);
    if (!email || email === actor || !email.includes("@")) continue;
    unique.add(email);
  }

  const allowed = await Promise.all(
    [...unique].map(async (email) =>
      (await wantsEmailNotifications(email)) ? email : null,
    ),
  );
  return allowed.filter((email): email is string => email !== null);
}

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

async function deliver(
  recipients: string[],
  build: (to: string) => Parameters<typeof sendClipsTransactionalEmail>[0],
): Promise<ActivityNotificationResult> {
  const result: ActivityNotificationResult = { sent: [], failed: [] };
  for (const to of recipients) {
    try {
      await sendClipsTransactionalEmail(build(to));
      result.sent.push(to);
    } catch (error) {
      result.failed.push({
        email: to,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (result.failed.length > 0) {
    console.error(
      `[clips] activity notification delivery failed for ${result.failed
        .map((f) => `${f.email} (${f.error})`)
        .join(", ")}`,
    );
  }
  return result;
}

export async function notifyRecordingComment(input: {
  recordingId: string;
  threadId: string;
  authorEmail: string;
  authorName?: string | null;
  content: string;
  videoTimestampMs?: number | null;
  isReply?: boolean;
}): Promise<ActivityNotificationResult> {
  if (!isEmailConfigured()) return EMPTY_RESULT;

  const recording = await getRecording(input.recordingId);
  if (!recording) return EMPTY_RESULT;

  const candidates = [recording.ownerEmail];
  if (input.isReply) {
    candidates.push(
      ...(await threadParticipants(input.recordingId, input.threadId)),
    );
  }

  const recipients = await recipientsFor(candidates, input.authorEmail);
  return deliver(recipients, (to) => ({
    kind: "activity-comment",
    to,
    recordingId: recording.id,
    title: recording.title,
    authorEmail: input.authorEmail,
    authorName: input.authorName ?? null,
    content: input.content,
    videoTimestampMs: input.videoTimestampMs ?? null,
    isReply: input.isReply ?? false,
  }));
}

export async function notifyRecordingReaction(input: {
  recordingId: string;
  emoji: string;
  viewerEmail: string;
  viewerName?: string | null;
  videoTimestampMs?: number | null;
  extraRecipients?: (string | null | undefined)[];
}): Promise<ActivityNotificationResult> {
  if (!isEmailConfigured()) return EMPTY_RESULT;

  const recording = await getRecording(input.recordingId);
  if (!recording) return EMPTY_RESULT;

  const recipients = await recipientsFor(
    [recording.ownerEmail, ...(input.extraRecipients ?? [])],
    input.viewerEmail,
  );
  return deliver(recipients, (to) => ({
    kind: "activity-reaction",
    to,
    recordingId: recording.id,
    title: recording.title,
    emoji: input.emoji,
    authorEmail: input.viewerEmail,
    authorName: input.viewerName ?? null,
    videoTimestampMs: input.videoTimestampMs ?? null,
  }));
}
