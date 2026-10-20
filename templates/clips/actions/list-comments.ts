import { defineAction } from "@agent-native/core/action";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isRecordingExpiredForViewer } from "../server/lib/recording-page-access.js";
import { hydrateCommentAuthorNames } from "../server/lib/user-identities.js";
import { displayCommentMentions } from "../shared/comment-mentions.js";

export default defineAction({
  mcpApp: { compactCatalog: true },
  description:
    "List threaded comments for a recording, sorted by videoTimestampMs then createdAt.",
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
  }),
  http: { method: "GET" },
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

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.recordingComments)
      .where(eq(schema.recordingComments.recordingId, args.recordingId))
      .orderBy(
        asc(schema.recordingComments.videoTimestampMs),
        asc(schema.recordingComments.createdAt),
      );

    const comments = await hydrateCommentAuthorNames(
      rows.map((c) => ({
        id: c.id,
        recordingId: c.recordingId,
        threadId: c.threadId,
        parentId: c.parentId,
        authorEmail: c.authorEmail,
        authorName: c.authorName,
        content: c.content,
        mentions: displayCommentMentions(c.mentionsJson),
        videoTimestampMs: c.videoTimestampMs,
        emojiReactionsJson: c.emojiReactionsJson,
        resolved: Boolean(c.resolved),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    );

    return { comments };
  },
});
