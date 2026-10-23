import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requestClips } from "../server/lib/clips-peer.js";
import {
  CLIP_PLAYBACK_ERRORS,
  type ClipCommentMarker,
} from "../shared/clips-peer-contract.js";
import {
  authorizeClipReader,
  clipEmbedArgsSchema,
  failClip,
} from "./_clip-embed-access.js";

const MAX_MARKERS = 500;
const MAX_PREVIEW_CHARS = 280;

const commentsSchema = z.object({
  comments: z.array(
    z.object({
      id: z.string(),
      parentId: z.string().nullable().optional(),
      authorEmail: z.string().nullable().optional(),
      authorName: z.string().nullable().optional(),
      content: z.string(),
      videoTimestampMs: z.number().min(0),
    }),
  ),
});

export default defineAction({
  description:
    "List where a Clip placed in a page has comment threads, for the markers on its player's scrubber. Checks the caller can read the page first. Fails with clip_comments_disabled, not an empty list, when the Clip's comments are off.",
  schema: clipEmbedArgsSchema,
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: false,
  agentTool: false,
  run: async ({
    documentId,
    recordingId,
  }): Promise<{ markers: ClipCommentMarker[] }> => {
    const reader = await authorizeClipReader(documentId);
    const result = await requestClips({
      reader,
      documentId,
      recordingId,
      resource: "comments",
    });
    if (!result.ok) failClip(result.code);

    const parsed = commentsSchema.safeParse(result.body);
    if (!parsed.success) {
      console.warn("[content-clips] unreadable comments answer", {
        recordingId,
      });
      failClip(CLIP_PLAYBACK_ERRORS.unreachable);
    }
    const markers = parsed.data.comments
      .filter((comment) => !comment.parentId)
      .slice(0, MAX_MARKERS)
      .map((comment) => ({
        id: comment.id,
        videoTimestampMs: comment.videoTimestampMs,
        content: comment.content.slice(0, MAX_PREVIEW_CHARS),
        // A signed-out reader sees names, never commenters' emails.
        authorName:
          comment.authorName?.trim() ||
          (reader.kind === "signed-in" ? comment.authorEmail || null : null),
      }));
    return { markers };
  },
});
