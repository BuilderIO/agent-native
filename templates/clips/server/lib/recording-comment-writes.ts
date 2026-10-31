import { fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  CONTENT_CLIP_COMMENT_KEY,
  CONTENT_CLIP_COMMENT_KEY_USED,
} from "../../shared/content-clip-contract.js";
import { getDb, schema } from "../db/index.js";
import {
  notifyRecordingComment,
  type ClipsActivityNotificationResult,
} from "./activity-notifications.js";
import { assertCommentAccess } from "./comment-access.js";
import { resolveCommentMentions } from "./comment-mentions.js";
import { nanoid } from "./recordings.js";

/** The `idempotencyKey` argument of the actions that add a comment. */
export const commentIdempotencyKeySchema = z
  .string()
  .regex(CONTENT_CLIP_COMMENT_KEY)
  .optional()
  .describe(
    "Optional key for this comment, 16-64 letters, digits, - or _ (a UUID works). Send the same key when retrying the same comment after an uncertain failure: the comment saved with it comes back instead of a second one. A new comment needs a new key.",
  );

export interface RecordingCommentInput {
  recordingId: string;
  content: string;
  videoTimestampMs: number;
  /** With `parentId`, for a reply; both absent for a new thread. */
  threadId?: string;
  parentId?: string;
  authorName?: string;
  mentions?: string | { email: string; name: string }[];
  /** One per comment its author means to post, the same on every try. */
  idempotencyKey?: string;
}

/**
 * A comment as it was saved. Only the call that saved it sends its
 * notifications; a repeat of a keyed comment gets its ids and nothing to send.
 */
export type SavedRecordingComment = {
  id: string;
  threadId: string;
  parentId: string | null;
} & (
  | {
      repeated: false;
      notify: () => Promise<ClipsActivityNotificationResult>;
    }
  | { repeated: true }
);

type CommentTarget = {
  recordingId: string;
  threadId: string | null;
  parentId: string | null;
  videoTimestampMs: number;
  content: string;
};

/**
 * The comment its author already saved with this key, or null. A key names
 * one comment, so a key sent again with a different one is refused rather
 * than answered with a comment that isn't the one sent.
 */
async function savedWithKey(
  authorEmail: string,
  idempotencyKey: string,
  target: CommentTarget,
): Promise<SavedRecordingComment | null> {
  const comments = schema.recordingComments;
  const rows = await getDb()
    .select({
      id: comments.id,
      recordingId: comments.recordingId,
      threadId: comments.threadId,
      parentId: comments.parentId,
      videoTimestampMs: comments.videoTimestampMs,
      content: comments.content,
    })
    .from(comments)
    .where(
      and(
        eq(comments.authorEmail, authorEmail),
        eq(comments.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  const saved = rows[0];
  if (
    saved.recordingId !== target.recordingId ||
    saved.parentId !== target.parentId ||
    (target.threadId !== null && saved.threadId !== target.threadId) ||
    saved.videoTimestampMs !== target.videoTimestampMs ||
    saved.content !== target.content
  ) {
    fail(
      "That idempotencyKey was already used for a different comment; send a new key for a new comment.",
      { statusCode: 409, errorCode: CONTENT_CLIP_COMMENT_KEY_USED },
    );
  }
  return {
    id: saved.id,
    threadId: saved.threadId,
    parentId: saved.parentId,
    repeated: true,
  };
}

/** Saves a comment on a recording as the request's signed-in user. */
export async function saveRecordingComment(
  args: RecordingCommentInput,
): Promise<SavedRecordingComment> {
  await assertCommentAccess(args.recordingId);

  const authorEmail = getRequestUserEmail();
  if (!authorEmail) {
    throw new Error("Sign in required to comment on recordings.");
  }
  const authorName =
    getRequestUserName()?.trim() || args.authorName?.trim() || null;

  const db = getDb();
  const id = nanoid();
  const hasParentId = args.parentId !== undefined;
  const hasThreadId = args.threadId !== undefined;
  if (
    hasParentId !== hasThreadId ||
    (hasParentId && (!args.parentId?.trim() || !args.threadId?.trim()))
  ) {
    throw new Error(
      "Replies must include non-empty threadId and parentId values.",
    );
  }
  const threadId = args.threadId?.trim() ?? id;
  const parentId = args.parentId?.trim() ?? null;
  const target: CommentTarget = {
    recordingId: args.recordingId,
    threadId: parentId ? threadId : null,
    parentId,
    videoTimestampMs: args.videoTimestampMs,
    content: args.content,
  };
  const key = args.idempotencyKey;
  if (key) {
    const saved = await savedWithKey(authorEmail, key, target);
    if (saved) return saved;
  }
  const now = new Date().toISOString();

  const recordings = await db
    .select({ organizationId: schema.recordings.organizationId })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, args.recordingId))
    .limit(1);
  if (recordings.length === 0) {
    throw new Error(`Recording not found: ${args.recordingId}`);
  }
  const rec = recordings[0];

  if (parentId) {
    const parents = await db
      .select({ id: schema.recordingComments.id })
      .from(schema.recordingComments)
      .where(
        and(
          eq(schema.recordingComments.id, parentId),
          eq(schema.recordingComments.recordingId, args.recordingId),
          eq(schema.recordingComments.organizationId, rec.organizationId),
          eq(schema.recordingComments.threadId, threadId),
        ),
      )
      .limit(1);
    if (parents.length === 0) {
      throw new Error("Parent comment does not belong to this recording.");
    }
  }

  const mentions = await resolveCommentMentions(
    args.mentions,
    rec.organizationId,
  );

  const insert = db.insert(schema.recordingComments).values({
    id,
    recordingId: args.recordingId,
    organizationId: rec.organizationId,
    threadId,
    parentId,
    authorEmail,
    authorName,
    content: args.content,
    mentionsJson: mentions.length > 0 ? JSON.stringify(mentions) : null,
    videoTimestampMs: args.videoTimestampMs,
    idempotencyKey: key ?? null,
    createdAt: now,
    updatedAt: now,
  });
  if (key) {
    const inserted = await insert
      .onConflictDoNothing({
        target: [
          schema.recordingComments.authorEmail,
          schema.recordingComments.idempotencyKey,
        ],
      })
      .returning({ id: schema.recordingComments.id });
    if (inserted.length === 0) {
      // A repeat with the same key saved it first, since the lookup above.
      const saved = await savedWithKey(authorEmail, key, target);
      // The unique index refused the insert, so that row was deleted since.
      if (!saved) {
        throw new Error("A comment with this idempotencyKey was just removed.");
      }
      return saved;
    }
  } else {
    await insert;
  }

  // The comment is saved: a refresh signal that fails must not make its
  // caller report a failure and post it again.
  try {
    await writeAppState("refresh-signal", { ts: Date.now() });
  } catch (error) {
    console.error(
      `[clips] refresh signal failed after comment ${id} was saved`,
      error instanceof Error ? error.message : error,
    );
  }

  console.log(
    `Added comment to recording ${args.recordingId} @ ${args.videoTimestampMs}ms (thread: ${threadId})`,
  );

  return {
    id,
    threadId,
    parentId,
    repeated: false,
    notify: () =>
      notifyRecordingComment({
        recordingId: args.recordingId,
        threadId,
        authorEmail,
        authorName: authorName ?? undefined,
        content: args.content,
        mentions,
        videoTimestampMs: args.videoTimestampMs,
        isReply: Boolean(parentId),
      }),
  };
}

/**
 * Saves a reply in the thread of the comment it answers, at that comment's
 * moment of the video.
 */
export async function saveRecordingReply(args: {
  commentId: string;
  content: string;
  authorName?: string;
  mentions?: RecordingCommentInput["mentions"];
  idempotencyKey?: string;
}): Promise<SavedRecordingComment> {
  const parents = await getDb()
    .select()
    .from(schema.recordingComments)
    .where(eq(schema.recordingComments.id, args.commentId))
    .limit(1);
  if (parents.length === 0) {
    throw new Error(`Comment not found: ${args.commentId}`);
  }
  const parent = parents[0];

  return saveRecordingComment({
    recordingId: parent.recordingId,
    threadId: parent.threadId,
    parentId: parent.id,
    videoTimestampMs: parent.videoTimestampMs,
    content: args.content,
    authorName: args.authorName,
    mentions: args.mentions,
    idempotencyKey: args.idempotencyKey,
  });
}
