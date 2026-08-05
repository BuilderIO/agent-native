/**
 * Add a comment to a recording at a specific video timestamp.
 *
 * For new threads, omit threadId/parentId. For replies, pass both.
 *
 * Usage:
 *   pnpm action add-comment --recordingId=<id> --content="Nice moment" --videoTimestampMs=12345
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyRecordingComment } from "../server/lib/activity-notifications.js";
import { nanoid } from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Add a comment to a recording at a specific video timestamp. For new threads, omit threadId/parentId. For replies, pass both.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
    content: z.string().min(1).describe("Comment text"),
    videoTimestampMs: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Video time (ms) the comment is attached to. Defaults to 0, or to the annotation's start time when annotationId is set.",
      ),
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
    annotationId: z
      .string()
      .optional()
      .describe(
        "Attach the comment to an annotation (timestamp marker or section). When set and videoTimestampMs is omitted, the comment inherits the annotation's start time.",
      ),
  }),
  run: async (args) => {
    // Viewer access is required (public/org recordings allow viewers to comment).
    await assertAccess("recording", args.recordingId, "viewer");

    const authorEmail = getRequestUserEmail();
    if (!authorEmail) {
      throw new Error("Sign in required to comment on recordings.");
    }

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

    // When anchoring to an annotation, verify it exists on this recording and
    // let the comment inherit its start time unless one was given explicitly.
    let videoTimestampMs = args.videoTimestampMs ?? 0;
    if (args.annotationId) {
      const [annotation] = await db
        .select({
          recordingId: schema.recordingAnnotations.recordingId,
          startMs: schema.recordingAnnotations.startMs,
        })
        .from(schema.recordingAnnotations)
        .where(eq(schema.recordingAnnotations.id, args.annotationId))
        .limit(1);
      if (!annotation || annotation.recordingId !== args.recordingId) {
        throw new Error(
          `Annotation ${args.annotationId} not found on recording ${args.recordingId}`,
        );
      }
      if (args.videoTimestampMs === undefined) {
        videoTimestampMs = annotation.startMs ?? 0;
      }
    }
    // Floor to the nearest second so nearby comments land on the same
    // timestamp bucket for scrubber grouping and the playback overlay.
    videoTimestampMs = Math.floor(videoTimestampMs / 1000) * 1000;

    await db.insert(schema.recordingComments).values({
      id,
      recordingId: args.recordingId,
      organizationId: rec.organizationId,
      threadId,
      parentId,
      authorEmail,
      authorName: args.authorName ?? null,
      content: args.content,
      videoTimestampMs,
      annotationId: args.annotationId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const notified = await notifyRecordingComment({
      recordingId: args.recordingId,
      threadId,
      authorEmail,
      authorName: args.authorName,
      content: args.content,
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
