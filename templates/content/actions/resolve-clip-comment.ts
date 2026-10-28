import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { writeClipComment } from "../server/lib/clips-peer.js";
import { CLIP_PLAYBACK_ERRORS } from "../shared/clips-peer-contract.js";
import {
  authorizeClipCommenter,
  clipEmbedArgsSchema,
  failClip,
} from "./_clip-embed-access.js";

const answerSchema = z.object({ id: z.string(), resolved: z.boolean() });

const booleanArg = z.preprocess(
  (value) => (value === "true" ? true : value === "false" ? false : value),
  z.boolean(),
);

export default defineAction({
  description:
    "Resolve or reopen a comment thread on a Clip placed in a page (threadId from list-clip-comments). Saved in Clips, which lets the thread's author or the Clip's editors do it and refuses anyone else with clip_forbidden. The caller must be able to comment on the page.",
  schema: clipEmbedArgsSchema.extend({
    threadId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .describe("Id of the thread, from list-clip-comments"),
    resolved: booleanArg.describe(
      "true to resolve the thread, false to reopen it",
    ),
  }),
  outputSchema: answerSchema,
  run: async ({ documentId, recordingId, threadId, resolved }) => {
    const reader = await authorizeClipCommenter(documentId);
    const result = await writeClipComment({
      reader,
      documentId,
      recordingId,
      write: { operation: "resolve", commentId: threadId, resolved },
    });
    if (!result.ok) failClip(result.code);
    const parsed = answerSchema.safeParse(result.body);
    if (!parsed.success || parsed.data.resolved !== resolved) {
      failClip(CLIP_PLAYBACK_ERRORS.unreachable);
    }
    return parsed.data;
  },
});
