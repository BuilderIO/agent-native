import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { type ClipReader, requestClips } from "../server/lib/clips-peer.js";
import {
  CLIP_PLAYBACK_ERRORS,
  CONTENT_CLIP_COMMENT_TEXT_CHARS,
  CONTENT_CLIP_MAX_COMMENT_THREADS,
  CONTENT_CLIP_MAX_LISTED_REPLIES,
  CONTENT_CLIP_OPEN_THREADS_VIEW,
  type ClipComment,
  type ClipCommentThread,
} from "../shared/clips-peer-contract.js";
import {
  authorizeClipReader,
  clipEmbedArgsSchema,
  failClip,
} from "./_clip-embed-access.js";

const listedComment = {
  id: z.string(),
  authorEmail: z.string().nullable().optional(),
  authorName: z.string().nullable().optional(),
  content: z.string(),
  createdAt: z.string(),
};

// Clips returns open threads only, never more than asked or than the
// contract's replies, and says whether it held threads back. A Clips from
// before the open-threads view answers without replies, which is refused
// rather than read as threads nobody replied to.
const commentsSchema = z.object({
  comments: z
    .array(
      z.object({
        ...listedComment,
        videoTimestampMs: z.number().min(0),
        replyCount: z.number().int().min(0),
        replies: z.array(z.object(listedComment)),
      }),
    )
    .max(CONTENT_CLIP_MAX_COMMENT_THREADS)
    .refine(
      (threads) =>
        threads.reduce((sum, thread) => sum + thread.replies.length, 0) <=
        CONTENT_CLIP_MAX_LISTED_REPLIES,
    ),
  truncated: z.boolean(),
});

const commentSchema = z.object({
  id: z.string(),
  authorEmail: z.string().nullable(),
  authorName: z.string().nullable(),
  content: z.string().max(CONTENT_CLIP_COMMENT_TEXT_CHARS),
  createdAt: z.string(),
});

const threadsSchema = z.object({
  threads: z
    .array(
      commentSchema.extend({
        videoTimestampMs: z.number(),
        replyCount: z.number(),
        replies: z.array(commentSchema),
      }),
    )
    .max(CONTENT_CLIP_MAX_COMMENT_THREADS),
  truncated: z.boolean(),
});

type ListedComment = z.infer<z.ZodObject<typeof listedComment>>;

function readerComment(reader: ClipReader, comment: ListedComment) {
  // A signed-out reader sees names, never commenters' emails.
  const authorEmail =
    reader.kind === "signed-in" ? comment.authorEmail || null : null;
  return {
    id: comment.id,
    authorEmail,
    authorName: comment.authorName?.trim() || authorEmail,
    content: comment.content.slice(0, CONTENT_CLIP_COMMENT_TEXT_CHARS),
    createdAt: comment.createdAt,
  } satisfies ClipComment;
}

export default defineAction({
  description:
    "List the open comment threads on a Clip placed in a page, ordered by the moment of the video each is at (videoTimestampMs), with each thread's text, author, and replies. Threads that are resolved in Clips are left out. Returns the first 500 threads, with truncated true when there are more; a thread whose replies are fewer than its replyCount had some held back. Checks the caller can read the page first. Fails with clip_comments_disabled, not an empty list, when the Clip's comments are off.",
  schema: clipEmbedArgsSchema,
  outputSchema: threadsSchema,
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: false,
  // Comment text and names are the reader's private view of the Clip.
  persistInBrowser: false,
  run: async ({
    documentId,
    recordingId,
  }): Promise<{ threads: ClipCommentThread[]; truncated: boolean }> => {
    const reader = await authorizeClipReader(documentId);
    const result = await requestClips({
      reader,
      documentId,
      recordingId,
      resource: "comments",
      query: {
        limit: String(CONTENT_CLIP_MAX_COMMENT_THREADS),
        view: CONTENT_CLIP_OPEN_THREADS_VIEW,
      },
    });
    if (!result.ok) failClip(result.code);

    const parsed = commentsSchema.safeParse(result.body);
    if (!parsed.success) {
      console.warn("[content-clips] unreadable comments answer", {
        recordingId,
      });
      failClip(CLIP_PLAYBACK_ERRORS.unreachable);
    }
    const threads = parsed.data.comments.map((thread) => ({
      ...readerComment(reader, thread),
      videoTimestampMs: thread.videoTimestampMs,
      replyCount: Math.max(thread.replyCount, thread.replies.length),
      replies: thread.replies.map((reply) => readerComment(reader, reply)),
    }));
    return { threads, truncated: parsed.data.truncated };
  },
});
