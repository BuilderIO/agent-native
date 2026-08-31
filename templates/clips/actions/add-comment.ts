/**
 * Add a comment to a recording at a specific video timestamp.
 *
 * For new threads, omit threadId/parentId. For replies, pass both.
 *
 * Usage:
 *   pnpm action add-comment --recordingId=<id> --content="Nice moment" --videoTimestampMs=12345
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
      .optional()
      .describe("Thread ID (for replies). Omit to start a new thread."),
    parentId: z
      .string()
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
    // Commenting is open to any signed-in viewer with access to the
    // recording, not just an explicitly-granted "commenter" role — the
    // `authorEmail` check below is what actually requires an account.
    const access = await assertAccess("recording", args.recordingId, "viewer");
    if (
      isRecordingExpired((access.resource as { expiresAt?: string }).expiresAt)
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
    const threadId = args.threadId ?? id;
    const parentId = args.parentId ?? null;
    const now = new Date().toISOString();

    // Look up recording's organization so the comment denormalizes it.
    const [rec] = await db
      .select({ organizationId: schema.recordings.organizationId })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId))
      .limit(1);

    if (!rec) throw new Error(`Recording not found: ${args.recordingId}`);

    const mentions = await resolveCommentMentions(
      args.mentions,
      rec.organizationId,
    );

    // Floor to the nearest second so nearby comments land on the same
    // timestamp bucket for scrubber grouping and the playback overlay.
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
