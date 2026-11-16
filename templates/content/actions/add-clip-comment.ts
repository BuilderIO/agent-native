import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  type ClipCommentWrite,
  writeClipComment,
} from "../server/lib/clips-peer.js";
import {
  CLIP_PLAYBACK_ERRORS,
  CONTENT_CLIP_COMMENT_KEY,
  CONTENT_CLIP_MAX_COMMENT_CHARS,
  CONTENT_CLIP_MAX_VIDEO_TIMESTAMP_MS,
} from "../shared/clips-peer-contract.js";
import {
  authorizeClipCommenter,
  clipEmbedArgsSchema,
  failClip,
} from "./_clip-embed-access.js";

const answerSchema = z.object({ id: z.string(), threadId: z.string() });

// Coercion would read null or a blank as 0:00 and start a real thread there.
const timestampArg = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() !== "" ? Number(value) : value,
  z.number().int().min(0).max(CONTENT_CLIP_MAX_VIDEO_TIMESTAMP_MS),
);

const ONE_TARGET =
  "Pass videoTimestampMs to start a thread or threadId to reply, not both";

export default defineAction({
  description:
    "Comment on a Clip placed in a page: start a thread at a moment of its video (videoTimestampMs), or reply to one of its threads (threadId from list-clip-comments). The comment is saved in Clips as the caller, who must be able to comment on the page. Pass idempotencyKey to make a retry safe: the same key with the same comment returns the comment already saved instead of adding another, and a key used for a different comment fails with clip_comment_key_used. Fails with clip_comments_disabled when the Clip's comments are off.",
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  schema: clipEmbedArgsSchema
    .extend({
      content: z
        .string()
        .trim()
        .min(1)
        .max(CONTENT_CLIP_MAX_COMMENT_CHARS)
        .describe("Comment text"),
      videoTimestampMs: timestampArg
        .optional()
        .describe(
          "Moment of the video to start a thread at, in milliseconds from its start. Omit when replying.",
        ),
      threadId: z
        .string()
        .trim()
        .min(1)
        .max(128)
        .optional()
        .describe(
          "Id of the thread to reply to, from list-clip-comments. Omit to start a thread.",
        ),
      idempotencyKey: z
        .string()
        .regex(CONTENT_CLIP_COMMENT_KEY)
        .optional()
        .describe(
          "Optional key for this comment, 16-64 letters, digits, - or _ (a UUID works). Send the same key when retrying the same comment after a failure that may have saved it. A new comment needs a new key.",
        ),
    })
    .refine(
      (args) =>
        (args.videoTimestampMs === undefined) !== (args.threadId === undefined),
      ONE_TARGET,
    ),
  outputSchema: answerSchema,
  run: async ({
    documentId,
    recordingId,
    content,
    videoTimestampMs,
    threadId,
    idempotencyKey,
  }) => {
    const write: ClipCommentWrite | null =
      threadId !== undefined
        ? { operation: "reply", commentId: threadId, content }
        : videoTimestampMs !== undefined
          ? { operation: "add", content, videoTimestampMs }
          : null;
    if (!write) fail(ONE_TARGET, { errorCode: "clip_comment_target" });
    const reader = await authorizeClipCommenter(documentId);
    const result = await writeClipComment({
      reader,
      documentId,
      recordingId,
      write,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
    if (!result.ok) failClip(result.code);
    const parsed = answerSchema.safeParse(result.body);
    if (!parsed.success) failClip(CLIP_PLAYBACK_ERRORS.unreachable);
    return { id: parsed.data.id, threadId: parsed.data.threadId };
  },
});
