/**
 * Reply to an existing comment.
 *
 * Thin wrapper around add-comment that sets threadId + parentId correctly.
 *
 * Usage:
 *   pnpm action reply-to-comment --commentId=<id> --content="..."
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
    "Reply to an existing comment. Looks up the thread and parent and delegates to add-comment.",
  schema: z.object({
    commentId: z.string().describe("Comment ID to reply to"),
    content: z.string().min(1).describe("Reply text"),
    authorName: z.string().optional(),
  }),
  run: async (args) => {
    const db = getDb();
    const [parent] = await db
      .select()
      .from(schema.recordingComments)
      .where(eq(schema.recordingComments.id, args.commentId))
      .limit(1);
    if (!parent) throw new Error(`Comment not found: ${args.commentId}`);

    await assertAccess("recording", parent.recordingId, "viewer");

    const id = nanoid();
    const authorEmail = getRequestUserEmail() ?? "local@localhost";
    const now = new Date().toISOString();

    await db.insert(schema.recordingComments).values({
      id,
      recordingId: parent.recordingId,
      workspaceId: parent.workspaceId,
      threadId: parent.threadId,
      parentId: parent.id,
      authorEmail,
      authorName: args.authorName ?? null,
      content: args.content,
      videoTimestampMs: parent.videoTimestampMs,
      createdAt: now,
      updatedAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Replied to comment ${args.commentId} (thread: ${parent.threadId})`,
    );

    return { id, threadId: parent.threadId, parentId: parent.id };
  },
});
