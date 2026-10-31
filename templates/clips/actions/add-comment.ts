import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  commentIdempotencyKeySchema,
  saveRecordingComment,
} from "../server/lib/recording-comment-writes.js";

const mentionSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1),
});

export default defineAction({
  description:
    "Add a comment to a recording at a specific video timestamp. Comment text supports inline Markdown such as bold, italic, inline code, and links; headings are flattened in comment surfaces. Organization members can be mentioned with @. For new threads, omit threadId/parentId. For replies, pass both.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    content: z
      .string()
      .min(1)
      .describe("Comment text; inline Markdown is supported, without headings"),
    videoTimestampMs: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        "Video time (ms) of the frame the comment is about, stored as given",
      ),
    threadId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Thread ID (for replies). Omit to start a new thread."),
    parentId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Parent comment ID (for replies)."),
    authorName: z
      .string()
      .optional()
      .describe("Display name for the author (falls back to email local part)"),
    mentions: z
      .union([z.string(), z.array(mentionSchema).max(20)])
      .optional()
      .describe("Organization members mentioned in the comment"),
    idempotencyKey: commentIdempotencyKeySchema,
  }),
  run: async (args) => {
    const saved = await saveRecordingComment(args);
    return {
      id: saved.id,
      threadId: saved.threadId,
      notified: saved.repeated ? null : await saved.notify(),
      repeated: saved.repeated,
    };
  },
});
