import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { writeClipComment } from "../server/lib/clips-peer.js";
import {
  CLIP_PLAYBACK_ERRORS,
  CONTENT_CLIP_MAX_COMMENT_CHARS,
  CONTENT_CLIP_MAX_VIDEO_TIMESTAMP_MS,
} from "../shared/clips-peer-contract.js";
import {
  authorizeClipCommenter,
  clipEmbedArgsSchema,
  failClip,
} from "./_clip-embed-access.js";

const answerSchema = z.object({ id: z.string(), threadId: z.string() });

export default defineAction({
  description:
    "Comment on a Clip placed in a page: start a thread at a moment of its video (videoTimestampMs), or reply to one of its threads (threadId from list-clip-comments). The comment is saved in Clips as the caller, who must be able to comment on the page. Fails with clip_comments_disabled when the Clip's comments are off.",
  schema: clipEmbedArgsSchema
    .extend({
      content: z
        .string()
        .trim()
        .min(1)
        .max(CONTENT_CLIP_MAX_COMMENT_CHARS)
        .describe("Comment text"),
      videoTimestampMs: z.coerce
        .number()
        .int()
        .min(0)
        .max(CONTENT_CLIP_MAX_VIDEO_TIMESTAMP_MS)
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
    })
    .refine(
      (args) =>
        (args.videoTimestampMs === undefined) !== (args.threadId === undefined),
      "Pass videoTimestampMs to start a thread or threadId to reply, not both",
    ),
  outputSchema: answerSchema,
  run: async ({
    documentId,
    recordingId,
    content,
    videoTimestampMs,
    threadId,
  }) => {
    const reader = await authorizeClipCommenter(documentId);
    const result = await writeClipComment({
      reader,
      documentId,
      recordingId,
      write:
        threadId === undefined
          ? { operation: "add", content, videoTimestampMs: videoTimestampMs! }
          : { operation: "reply", commentId: threadId, content },
    });
    if (!result.ok) failClip(result.code);
    const parsed = answerSchema.safeParse(result.body);
    if (!parsed.success) failClip(CLIP_PLAYBACK_ERRORS.unreachable);
    return { id: parsed.data.id, threadId: parsed.data.threadId };
  },
});
