/**
 * Add a comment to a recording at a specific video timestamp.
 *
 * For new threads, omit threadId/parentId. For replies, pass both.
 *
 * Usage:
 *   pnpm action add-comment --recordingId=<id> --content="Nice moment" --videoTimestampMs=12345
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { nanoid } from "../server/lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";

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

    await db.insert(schema.recordingComments).values({
      id,
      recordingId: args.recordingId,
      organizationId: rec.organizationId,
      threadId,
      parentId,
      authorEmail,
      authorName: args.authorName ?? null,
      content: args.content,
      videoTimestampMs: args.videoTimestampMs,
      createdAt: now,
      updatedAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Added comment to recording ${args.recordingId} @ ${args.videoTimestampMs}ms (thread: ${threadId})`,
    );

    return { id, threadId };
  },
});
