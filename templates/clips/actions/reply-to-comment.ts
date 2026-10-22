import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import addComment from "./add-comment.js";

const mentionSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1),
});

export default defineAction({
  description:
    "Reply to an existing comment with inline Markdown text (without headings). Organization members can be mentioned with @. Looks up the thread and parent and delegates to add-comment.",
  schema: z.object({
    commentId: z.string().describe("Comment ID to reply to"),
    content: z
      .string()
      .min(1)
      .describe("Reply text; inline Markdown is supported, without headings"),
    authorName: z.string().optional(),
    mentions: z
      .union([z.string(), z.array(mentionSchema).max(20)])
      .optional()
      .describe("Organization members mentioned in the reply"),
  }),
  run: async (args) => {
    const db = getDb();
    const [parent] = await db
      .select()
      .from(schema.recordingComments)
      .where(eq(schema.recordingComments.id, args.commentId))
      .limit(1);
    if (!parent) throw new Error(`Comment not found: ${args.commentId}`);

    const result = await addComment.run({
      recordingId: parent.recordingId,
      threadId: parent.threadId,
      parentId: parent.id,
      videoTimestampMs: parent.videoTimestampMs,
      content: args.content,
      authorName: args.authorName,
      mentions: args.mentions,
    });

    return { ...result, parentId: parent.id };
  },
});
