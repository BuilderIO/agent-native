import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requestClips } from "../server/lib/clips-peer.js";
import {
  CLIP_PLAYBACK_ERRORS,
  CONTENT_CLIP_COMMENT_PREVIEW_CHARS,
  CONTENT_CLIP_MAX_COMMENT_THREADS,
  type ClipCommentMarker,
} from "../shared/clips-peer-contract.js";
import {
  authorizeClipReader,
  clipEmbedArgsSchema,
  failClip,
} from "./_clip-embed-access.js";

// Clips returns thread starts only, never more than asked, and says whether
// it held any back.
const commentsSchema = z.object({
  comments: z
    .array(
      z.object({
        id: z.string(),
        authorEmail: z.string().nullable().optional(),
        authorName: z.string().nullable().optional(),
        content: z.string(),
        videoTimestampMs: z.number().min(0),
      }),
    )
    .max(CONTENT_CLIP_MAX_COMMENT_THREADS),
  truncated: z.boolean(),
});

export default defineAction({
  description:
    "List where a Clip placed in a page has comment threads, for the markers on its player's scrubber: the first 500 by video time, with truncated true when there are more. Checks the caller can read the page first. Fails with clip_comments_disabled, not an empty list, when the Clip's comments are off.",
  schema: clipEmbedArgsSchema,
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: false,
  agentTool: false,
  // Comment text and names are the reader's private view of the Clip.
  persistInBrowser: false,
  run: async ({
    documentId,
    recordingId,
  }): Promise<{ markers: ClipCommentMarker[]; truncated: boolean }> => {
    const reader = await authorizeClipReader(documentId);
    const result = await requestClips({
      reader,
      documentId,
      recordingId,
      resource: "comments",
      query: { limit: String(CONTENT_CLIP_MAX_COMMENT_THREADS) },
    });
    if (!result.ok) failClip(result.code);

    const parsed = commentsSchema.safeParse(result.body);
    if (!parsed.success) {
      console.warn("[content-clips] unreadable comments answer", {
        recordingId,
      });
      failClip(CLIP_PLAYBACK_ERRORS.unreachable);
    }
    const markers = parsed.data.comments.map((comment) => ({
      id: comment.id,
      videoTimestampMs: comment.videoTimestampMs,
      content: comment.content.slice(0, CONTENT_CLIP_COMMENT_PREVIEW_CHARS),
      // A signed-out reader sees names, never commenters' emails.
      authorName:
        comment.authorName?.trim() ||
        (reader.kind === "signed-in" ? comment.authorEmail || null : null),
    }));
    return { markers, truncated: parsed.data.truncated };
  },
});
