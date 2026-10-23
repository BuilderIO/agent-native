import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requestClips } from "../server/lib/clips-peer.js";
import {
  CLIP_PLAYBACK_ERRORS,
  type ClipPlayback,
} from "../shared/clips-peer-contract.js";
import {
  authorizeClipReader,
  clipEmbedArgsSchema,
  failClip,
} from "./_clip-embed-access.js";

const mediaUrl = z
  .string()
  .refine(
    (value) =>
      URL.canParse(value) &&
      ["https:", "http:"].includes(new URL(value).protocol),
  )
  .nullable();

const playbackSchema = z.object({
  recording: z.object({
    id: z.string(),
    title: z.string().nullable(),
    kind: z.string().nullable(),
    status: z.string().nullable(),
    durationMs: z.number().nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    enableComments: z.boolean(),
    embedProvider: z.string().nullable(),
  }),
  playback: z.object({
    videoUrl: mediaUrl,
    posterUrl: mediaUrl,
    expiresAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  }),
  viewer: z.object({ isOwner: z.boolean(), canComment: z.boolean() }),
});

export default defineAction({
  description:
    "Play a Clip placed in a page. Checks the caller can read the page, then asks Clips for playback URLs that stop working within minutes; the Clip block's player calls it again when they do.",
  schema: clipEmbedArgsSchema,
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: false,
  agentTool: false,
  run: async ({ documentId, recordingId }): Promise<ClipPlayback> => {
    const reader = await authorizeClipReader(documentId);
    const result = await requestClips({
      reader,
      documentId,
      recordingId,
      resource: "playback",
    });
    if (!result.ok) failClip(result.code);

    const parsed = playbackSchema.safeParse(result.body);
    if (!parsed.success || parsed.data.recording.id !== recordingId) {
      console.warn("[content-clips] unreadable playback answer", {
        recordingId,
      });
      failClip(CLIP_PLAYBACK_ERRORS.unreachable);
    }
    return parsed.data;
  },
});
