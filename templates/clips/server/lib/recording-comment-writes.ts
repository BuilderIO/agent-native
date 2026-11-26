import { fail, type ActionRunContext } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import {
  extractReviewMentions,
  getReviewCommentById,
  ReviewCommentSubmissionConflictError,
  reviewCommentIdForClientOperation,
  type ReviewComment,
  type ReviewNotificationResult,
} from "@agent-native/core/review";
import createReviewComment from "@agent-native/core/review/actions/create-review-comment";
import replyReviewComment from "@agent-native/core/review/actions/reply-review-comment";
import { getRequestUserName } from "@agent-native/core/server/request-context";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { CommentMention } from "../../shared/comment-mentions.js";
import {
  CONTENT_CLIP_COMMENT_KEY,
  CONTENT_CLIP_COMMENT_KEY_USED,
} from "../../shared/content-clip-contract.js";
import { getDb, schema } from "../db/index.js";
import { assertCommentAccess } from "./comment-access.js";
import { resolveCommentMentions } from "./comment-mentions.js";
import { firstRow } from "./first-row.js";
import {
  commentClientOperationId,
  commentVideoTimestampMs,
  findRecordingComment,
  kitMentions,
  RECORDING_REVIEW_RESOURCE,
  recordingReviewContext,
  VIDEO_TIME_ANCHOR,
} from "./recording-comments.js";

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
  threadId?: string | undefined;
  parentId?: string | undefined;
  authorName?: string | undefined;
  mentions?: string | { email: string; name: string }[] | undefined;
  /** One per comment its author means to post, the same on every try. */
  idempotencyKey?: string | undefined;
}

export interface SavedRecordingComment {
  id: string;
  threadId: string;
  parentId: string | null;
  repeated: boolean;
  notified: ReviewNotificationResult | null;
}

const KEY_USED =
  "That idempotencyKey was already used for a different comment; send a new key for a new comment.";
const KEY_DELETED =
  "The comment saved with that idempotencyKey was deleted; send a new key for a new comment.";
const KEY_NOT_READY =
  "The comment saved with that idempotencyKey isn't ready yet; send it again with the same key in a minute.";

interface KeyedComment {
  recordingId: string;
  threadId: string | null;
  parentId: string | null;
  videoTimestampMs: number;
  content: string;
  mentions: readonly CommentMention[];
}

function sortedEmails(mentions: readonly { email?: string | null }[]) {
  const emails = new Set<string>();
  for (const mention of mentions) {
    if (mention.email) emails.add(mention.email.trim().toLowerCase());
  }
  return [...emails].sort().join("\n");
}

function refuseKey(message: string): never {
  fail(message, { statusCode: 409, errorCode: CONTENT_CLIP_COMMENT_KEY_USED });
}

function replayed(
  saved: ReviewComment,
  target: KeyedComment,
  mentions: readonly { email?: string | null }[],
): SavedRecordingComment {
  if (saved.status === "deleted") refuseKey(KEY_DELETED);
  if (
    saved.resourceId !== target.recordingId ||
    saved.parentCommentId !== target.parentId ||
    (target.threadId !== null && saved.threadId !== target.threadId) ||
    (target.parentId === null &&
      commentVideoTimestampMs(saved.anchor) !== target.videoTimestampMs) ||
    saved.body !== target.content ||
    sortedEmails(saved.mentions) !== sortedEmails(mentions)
  ) {
    refuseKey(KEY_USED);
  }
  return {
    id: saved.id,
    threadId: saved.threadId,
    parentId: saved.parentCommentId,
    repeated: true,
    notified: null,
  };
}

async function savedWithKey(
  clientOperationId: string,
  target: KeyedComment,
): Promise<SavedRecordingComment | null> {
  const saved = await getReviewCommentById(
    reviewCommentIdForClientOperation(clientOperationId),
    {},
    { bypassScope: true },
  );
  return saved
    ? replayed(saved, target, [
        ...target.mentions,
        ...extractReviewMentions(target.content),
      ])
    : null;
}

async function savedBeforeKit(
  authorEmail: string,
  idempotencyKey: string,
  target: KeyedComment,
): Promise<SavedRecordingComment | null> {
  const comments = schema.recordingComments;
  const saved = firstRow(
    await getDb()
      .select({ id: comments.id })
      .from(comments)
      .where(
        and(
          eq(comments.authorEmail, authorEmail),
          eq(comments.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1),
  );
  if (!saved) return null;
  const copy = await getReviewCommentById(saved.id, {}, { bypassScope: true });
  if (!copy) {
    fail(KEY_NOT_READY, { statusCode: 409, errorCode: "comment_not_ready" });
  }
  return replayed(copy, target, target.mentions);
}

async function unlessKeyConflict<T>(
  write: () => Promise<T>,
): Promise<T | null> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof ReviewCommentSubmissionConflictError) return null;
    throw error;
  }
}

export async function saveRecordingComment(
  args: RecordingCommentInput,
  ctx?: ActionRunContext,
): Promise<SavedRecordingComment> {
  const access = await assertCommentAccess(
    args.recordingId,
    "write",
    ctx?.requestHeaders,
  );

  const reviewCtx = recordingReviewContext(ctx);
  const authorEmail = reviewCtx.userEmail;
  if (!authorEmail) {
    throw new Error("Sign in required to comment on recordings.");
  }
  const authorName =
    getRequestUserName()?.trim() || args.authorName?.trim() || null;

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
  const parentId = args.parentId?.trim() ?? null;

  const recording = access.resource as { organizationId: string | null };
  const mentions = await resolveCommentMentions(
    args.mentions,
    recording.organizationId ?? "",
  );
  let keyedComment: { clientOperationId: string; target: KeyedComment } | null =
    null;
  if (args.idempotencyKey) {
    const clientOperationId = commentClientOperationId(
      authorEmail,
      args.idempotencyKey,
    );
    const target: KeyedComment = {
      recordingId: args.recordingId,
      threadId: parentId ? (args.threadId?.trim() ?? null) : null,
      parentId,
      videoTimestampMs: args.videoTimestampMs,
      content: args.content,
      mentions,
    };
    const saved =
      (await savedWithKey(clientOperationId, target)) ??
      (await savedBeforeKit(authorEmail, args.idempotencyKey, target));
    if (saved) return saved;
    keyedComment = { clientOperationId, target };
  }

  const shared = {
    resourceType: RECORDING_REVIEW_RESOURCE,
    resourceId: args.recordingId,
    body: args.content,
    authorName,
    mentions: kitMentions(mentions),
    ...(keyedComment
      ? { clientOperationId: keyedComment.clientOperationId }
      : {}),
  };
  const saved = await unlessKeyConflict(async () => {
    if (!parentId) {
      return createReviewComment.run(
        {
          ...shared,
          anchor: { videoTimestampMs: args.videoTimestampMs },
          anchorKind: VIDEO_TIME_ANCHOR,
        },
        reviewCtx,
      );
    }
    const parent = await findRecordingComment(parentId);
    if (
      !parent ||
      parent.resourceId !== args.recordingId ||
      parent.threadId !== args.threadId?.trim()
    ) {
      throw new Error("Parent comment does not belong to this recording.");
    }
    return replyReviewComment.run(
      { ...shared, commentId: parent.id },
      reviewCtx,
    );
  });
  if (!saved) {
    const replay =
      keyedComment &&
      (await savedWithKey(keyedComment.clientOperationId, keyedComment.target));
    if (!replay) refuseKey(KEY_USED);
    return replay;
  }

  const result = {
    id: saved.id,
    threadId: saved.threadId,
    parentId: saved.parentCommentId,
    repeated: saved.replayed,
    notified: saved.notified,
  };
  if (saved.replayed) return result;

  // The comment is saved: a refresh signal that fails must not make its
  // caller report a failure and post it again.
  try {
    await writeAppState("refresh-signal", { ts: Date.now() });
  } catch (error) {
    console.error(
      `[clips] refresh signal failed after comment ${saved.id} was saved`,
      error instanceof Error ? error.message : error,
    );
  }

  console.log(
    `Added comment to recording ${args.recordingId} @ ${args.videoTimestampMs}ms (thread: ${saved.threadId})`,
  );

  return result;
}

/**
 * Saves a reply in the thread of the comment it answers, at that comment's
 * moment of the video.
 */
export async function saveRecordingReply(
  args: {
    commentId: string;
    content: string;
    authorName?: string | undefined;
    mentions?: RecordingCommentInput["mentions"];
    idempotencyKey?: string | undefined;
  },
  ctx?: ActionRunContext,
): Promise<SavedRecordingComment> {
  const parent = await findRecordingComment(args.commentId);
  if (!parent) {
    throw new Error(`Comment not found: ${args.commentId}`);
  }

  return saveRecordingComment(
    {
      recordingId: parent.resourceId,
      threadId: parent.threadId,
      parentId: parent.id,
      videoTimestampMs: commentVideoTimestampMs(parent.anchor),
      content: args.content,
      authorName: args.authorName,
      mentions: args.mentions,
      idempotencyKey: args.idempotencyKey,
    },
    ctx,
  );
}
