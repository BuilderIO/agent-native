/**
 * List threaded comments for a recording.
 *
 * Returns a flat array sorted by videoTimestampMs then createdAt. The UI
 * groups into threads client-side using threadId/parentId.
 *
 * Usage:
 *   pnpm action list-comments --recordingId=<id>
 */

import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "List threaded comments for a recording, sorted by videoTimestampMs then createdAt.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "viewer");

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.recordingComments)
      .where(eq(schema.recordingComments.recordingId, args.recordingId))
      .orderBy(
        asc(schema.recordingComments.videoTimestampMs),
        asc(schema.recordingComments.createdAt),
      );

    const comments = rows.map((c) => ({
      id: c.id,
      recordingId: c.recordingId,
      threadId: c.threadId,
      parentId: c.parentId,
      authorEmail: c.authorEmail,
      authorName: c.authorName,
      content: c.content,
      videoTimestampMs: c.videoTimestampMs,
      emojiReactionsJson: c.emojiReactionsJson,
      resolved: Boolean(c.resolved),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));

    return { comments };
  },
});
