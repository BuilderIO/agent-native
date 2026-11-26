import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

import type { ActionRunContext } from "@agent-native/core/action";
import { table, text } from "@agent-native/core/db/schema";
import {
  getReviewCommentById,
  listReviewCommentReactors,
  moveMirroredReviewAnchors,
  queryReviewComments,
  type ReviewComment,
  type ReviewCommentPosition,
  type ReviewMention,
  type ReviewResourceContext,
} from "@agent-native/core/review";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { and, eq, isNull, ne } from "drizzle-orm";

import {
  normalizeCommentMentions,
  type CommentMention,
} from "../../shared/comment-mentions.js";
import type { getDb } from "../db/index.js";

export const RECORDING_REVIEW_RESOURCE = "recording";
export const VIDEO_TIME_ANCHOR = "video-time";

export const reviewComments = table("agent_review_comments", {
  id: text("id").primaryKey(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  threadId: text("thread_id").notNull(),
  parentCommentId: text("parent_comment_id"),
  status: text("status").notNull(),
  anchorJson: text("anchor_json"),
  body: text("body").notNull(),
  authorEmail: text("author_email"),
  authorName: text("author_name"),
  mentionsJson: text("mentions_json"),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull(),
});

export function liveRecordingComments() {
  return and(
    eq(reviewComments.resourceType, RECORDING_REVIEW_RESOURCE),
    isNull(reviewComments.deletedAt),
    ne(reviewComments.status, "deleted"),
  );
}

export function recordingReviewContext(
  ctx: ActionRunContext | undefined,
): ActionRunContext & ReviewResourceContext {
  const userEmail = ctx?.userEmail ?? getRequestUserEmail();
  return {
    ...ctx,
    caller: ctx?.caller ?? "frontend",
    ...(userEmail ? { userEmail } : {}),
    orgId: ctx?.orgId ?? getRequestOrgId() ?? null,
  };
}

const DELETING_COMMENT = "clipsDeletingComment";

export function commentDeleteContext(
  ctx: ActionRunContext | undefined,
): ActionRunContext & ReviewResourceContext {
  return { ...recordingReviewContext(ctx), [DELETING_COMMENT]: true };
}

export function isCommentDelete(
  ctx: ReviewResourceContext | undefined,
): boolean {
  return ctx?.[DELETING_COMMENT] === true;
}

export async function findRecordingComment(
  id: string,
): Promise<ReviewComment | null> {
  const comment = await getReviewCommentById(id, {}, { bypassScope: true });
  return comment &&
    comment.resourceType === RECORDING_REVIEW_RESOURCE &&
    comment.status !== "deleted"
    ? comment
    : null;
}

const KIT_PAGE_SIZE = 500;

export async function recordingKitComments(
  recordingId: string,
  threadId?: string,
): Promise<ReviewComment[]> {
  const comments: ReviewComment[] = [];
  let after: ReviewCommentPosition | undefined;
  for (;;) {
    const page = await queryReviewComments({
      resourceType: RECORDING_REVIEW_RESOURCE,
      resourceId: recordingId,
      scope: {},
      bypassScope: true,
      includeResolved: true,
      ...(threadId ? { threadId } : {}),
      after,
      limit: KIT_PAGE_SIZE,
    });
    comments.push(...page);
    const full = page.length === KIT_PAGE_SIZE;
    const last = page.pop();
    if (!full || !last) return comments;
    after = { createdAt: last.createdAt, id: last.id };
  }
}

export async function shiftRecordingComments(
  tx: Pick<ReturnType<typeof getDb>, "select">,
  recordingId: string,
  addedMs: number,
): Promise<void> {
  const comments = await tx
    .select({ id: reviewComments.id, anchorJson: reviewComments.anchorJson })
    .from(reviewComments)
    .where(
      and(liveRecordingComments(), eq(reviewComments.resourceId, recordingId)),
    )
    .for("update");
  await moveMirroredReviewAnchors(
    { resourceType: RECORDING_REVIEW_RESOURCE, resourceId: recordingId },
    comments.map((comment) => ({
      id: comment.id,
      anchor: {
        videoTimestampMs: storedVideoTimestampMs(comment.anchorJson) + addedMs,
      },
    })),
  );
}

export function commentVideoTimestampMs(anchor: unknown): number {
  const time =
    anchor && typeof anchor === "object"
      ? (anchor as { videoTimestampMs?: unknown }).videoTimestampMs
      : undefined;
  return typeof time === "number" && Number.isFinite(time) ? time : 0;
}

export function storedVideoTimestampMs(anchorJson: string | null): number {
  if (!anchorJson) return 0;
  try {
    return commentVideoTimestampMs(JSON.parse(anchorJson));
    // coercion-ok: the kit writes every recording anchor as JSON; an unreadable one sits at the start.
  } catch {
    return 0;
  }
}

export function clipsMentions(
  mentions: readonly ReviewMention[] | string | null,
): CommentMention[] {
  let list: unknown = mentions;
  if (typeof mentions === "string") {
    try {
      list = JSON.parse(mentions);
      // coercion-ok: malformed optional mention metadata is treated as absent.
    } catch {
      return [];
    }
  }
  return normalizeCommentMentions(
    Array.isArray(list)
      ? list.map((mention: { label?: unknown; email?: unknown } | null) => ({
          email: mention?.email,
          name: mention?.label,
        }))
      : [],
  );
}

export function kitMentions(
  mentions: readonly CommentMention[],
): Array<{ label: string; email: string }> {
  return mentions.map(({ email, name }) => ({ label: name, email }));
}

export interface RecordingCommentRow {
  id: string;
  recordingId: string;
  threadId: string;
  parentId: string | null;
  authorEmail: string;
  authorName: string | null;
  content: string;
  mentions: CommentMention[];
  videoTimestampMs: number;
  emojiReactionsJson: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export function byVideoTime(
  a: Pick<RecordingCommentRow, "videoTimestampMs" | "createdAt" | "id">,
  b: Pick<RecordingCommentRow, "videoTimestampMs" | "createdAt" | "id">,
): number {
  return (
    a.videoTimestampMs - b.videoTimestampMs ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

export async function toRecordingCommentRows(
  comments: readonly ReviewComment[],
): Promise<RecordingCommentRow[]> {
  const reactors = await listReviewCommentReactors(
    comments.map((comment) => comment.id),
  );
  return comments
    .map((comment) => ({
      id: comment.id,
      recordingId: comment.resourceId,
      threadId: comment.threadId,
      parentId:
        comment.parentCommentId ??
        (comment.threadId === comment.id ? null : comment.threadId),
      authorEmail: comment.authorEmail ?? "",
      authorName: comment.authorName,
      content: comment.body,
      mentions: clipsMentions(comment.mentions),
      videoTimestampMs: commentVideoTimestampMs(comment.anchor),
      emojiReactionsJson: JSON.stringify(reactors[comment.id] ?? {}),
      resolved: comment.status === "resolved",
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    }))
    .sort(byVideoTime);
}

export async function listRecordingComments(
  recordingId: string,
): Promise<RecordingCommentRow[]> {
  return toRecordingCommentRows(await recordingKitComments(recordingId));
}

export function commentClientOperationId(
  authorEmail: string,
  idempotencyKey: string,
): string {
  const hex = createHash("sha256")
    .update(`${authorEmail.trim().toLowerCase()}\n${idempotencyKey}`)
    .digest("hex");
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

const commentEmailsLater = new AsyncLocalStorage<
  (sending: Promise<unknown>) => void
>();

export function withCommentEmailsLater<T>(
  later: (sending: Promise<unknown>) => void,
  write: () => Promise<T>,
): Promise<T> {
  return commentEmailsLater.run(later, write);
}

export function commentEmailsSentLater():
  | ((sending: Promise<unknown>) => void)
  | undefined {
  return commentEmailsLater.getStore();
}
