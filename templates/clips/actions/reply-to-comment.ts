import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  commentIdempotencyKeySchema,
  saveRecordingReply,
} from "../server/lib/recording-comment-writes.js";

const mentionSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1),
});

export default defineAction({
  mcpApp: { compactCatalog: true },
  description:
    "Reply to a comment on a recording, as the signed-in user, in that comment's thread. Comment IDs come from get-recording-player-data. The reply is inline Markdown without headings; organization members can be mentioned with @. Returns the new reply's id.",
  schema: z.object({
    commentId: z.string().describe("Comment ID to reply to"),
    content: z
      .string()
      .min(1)
      .describe("Reply text; inline Markdown is supported, without headings"),
    authorName: z
      .string()
      .optional()
      .describe("Name to show only when the signed-in account has none"),
    mentions: z
      .union([z.string(), z.array(mentionSchema).max(20)])
      .optional()
      .describe("Organization members mentioned in the reply"),
    idempotencyKey: commentIdempotencyKeySchema,
  }),
  run: async (args) => {
    const saved = await saveRecordingReply(args);
    return {
      id: saved.id,
      threadId: saved.threadId,
      notified: saved.repeated ? null : await saved.notify(),
      repeated: saved.repeated,
      parentId: saved.parentId,
    };
  },
});
