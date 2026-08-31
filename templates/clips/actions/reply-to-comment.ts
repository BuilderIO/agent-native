/**
 * Reply to an existing comment.
 *
 * Thin wrapper around add-comment that sets threadId + parentId correctly.
 *
 * Usage:
 *   pnpm action reply-to-comment --commentId=<id> --content="..."
 */

import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyRecordingComment } from "../server/lib/activity-notifications.js";
import { resolveCommentMentions } from "../server/lib/comment-mentions.js";
import { isRecordingExpired } from "../server/lib/recording-page-access.js";
import { nanoid } from "../server/lib/recordings.js";

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

    // Any signed-in viewer with access to the recording may reply, matching
    // add-comment's top-level comment gate — there's no separate
    // "commenter" tier to require.
    const access = await assertAccess(
      "recording",
      parent.recordingId,
      "viewer",
    );
    if (
      isRecordingExpired((access.resource as { expiresAt?: string }).expiresAt)
    ) {
      throw new ForbiddenError("Recording has expired");
    }

    const authorEmail = getRequestUserEmail();
    if (!authorEmail) {
      throw new Error("Sign in required to reply to comments.");
    }
    const authorName =
      getRequestUserName()?.trim() || args.authorName?.trim() || null;
    const mentions = await resolveCommentMentions(
      args.mentions,
      parent.organizationId,
    );

    const id = nanoid();
    const now = new Date().toISOString();

    await db.insert(schema.recordingComments).values({
      id,
      recordingId: parent.recordingId,
      organizationId: parent.organizationId,
      threadId: parent.threadId,
      parentId: parent.id,
      authorEmail,
      authorName,
      content: args.content,
      mentionsJson: mentions.length > 0 ? JSON.stringify(mentions) : null,
      videoTimestampMs: parent.videoTimestampMs,
      createdAt: now,
      updatedAt: now,
    });

    const notified = await notifyRecordingComment({
      recordingId: parent.recordingId,
      threadId: parent.threadId,
      authorEmail,
      authorName: authorName ?? undefined,
      content: args.content,
      mentions,
      videoTimestampMs: parent.videoTimestampMs,
      isReply: true,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Replied to comment ${args.commentId} (thread: ${parent.threadId})`,
    );

    return { id, threadId: parent.threadId, parentId: parent.id, notified };
  },
});
