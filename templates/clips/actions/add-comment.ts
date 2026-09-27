import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyRecordingComment } from "../server/lib/activity-notifications.js";
import { resolveCommentMentions } from "../server/lib/comment-mentions.js";
import { isRecordingExpiredForViewer } from "../server/lib/recording-page-access.js";
import { nanoid } from "../server/lib/recordings.js";

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
      .describe("Video time (ms) the comment is attached to"),
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
  }),
  run: async (args) => {
    const access = await assertAccess("recording", args.recordingId, "viewer");
    if (
      isRecordingExpiredForViewer({
        expiresAt: (access.resource as { expiresAt?: string }).expiresAt,
        viewerIsOwner: access.role === "owner",
      })
    ) {
      throw new ForbiddenError("Recording has expired");
    }

    const authorEmail = getRequestUserEmail();
    if (!authorEmail) {
      throw new Error("Sign in required to comment on recordings.");
    }
    const authorName =
      getRequestUserName()?.trim() || args.authorName?.trim() || null;

    const db = getDb();
    const id = nanoid();
    const hasParentId = args.parentId !== undefined;
    const hasThreadId = args.threadId !== undefined;
    if (
      hasParentId !== hasThreadId ||
      (hasParentId && (!args.parentId?.trim() || !args.threadId?.trim()))
    ) {
      throw new Error(
        "Replies must include non-empty threadId and parentId values.",
      );
    }
    const threadId = args.threadId?.trim() ?? id;
    const parentId = args.parentId?.trim() ?? null;
    const now = new Date().toISOString();

    const [rec] = await db
      .select({ organizationId: schema.recordings.organizationId })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId))
      .limit(1);

    if (!rec) throw new Error(`Recording not found: ${args.recordingId}`);

    if (parentId) {
      const [parent] = await db
        .select({
          id: schema.recordingComments.id,
          recordingId: schema.recordingComments.recordingId,
          organizationId: schema.recordingComments.organizationId,
          threadId: schema.recordingComments.threadId,
        })
        .from(schema.recordingComments)
        .where(
          and(
            eq(schema.recordingComments.id, parentId),
            eq(schema.recordingComments.recordingId, args.recordingId),
            eq(schema.recordingComments.organizationId, rec.organizationId),
            eq(schema.recordingComments.threadId, threadId),
          ),
        )
        .limit(1);

      if (!parent) {
        throw new Error("Parent comment does not belong to this recording.");
      }
    }

    const mentions = await resolveCommentMentions(
      args.mentions,
      rec.organizationId,
    );

    const videoTimestampMs = Math.floor(args.videoTimestampMs / 1000) * 1000;

    await db.insert(schema.recordingComments).values({
      id,
      recordingId: args.recordingId,
      organizationId: rec.organizationId,
      threadId,
      parentId,
      authorEmail,
      authorName,
      content: args.content,
      mentionsJson: mentions.length > 0 ? JSON.stringify(mentions) : null,
      videoTimestampMs,
      createdAt: now,
      updatedAt: now,
    });

    const notified = await notifyRecordingComment({
      recordingId: args.recordingId,
      threadId,
      authorEmail,
      authorName: authorName ?? undefined,
      content: args.content,
      mentions,
      videoTimestampMs: args.videoTimestampMs,
      isReply: Boolean(parentId),
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Added comment to recording ${args.recordingId} @ ${videoTimestampMs}ms (thread: ${threadId})`,
    );

    return { id, threadId, notified };
  },
});
