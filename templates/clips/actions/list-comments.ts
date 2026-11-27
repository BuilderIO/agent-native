import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { assertCommentAccess } from "../server/lib/comment-access.js";
import { listRecordingComments } from "../server/lib/recording-comments.js";
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
  run: async (args, ctx) => {
    await assertCommentAccess(args.recordingId, "read", ctx?.requestHeaders);

    const rows = await listRecordingComments(args.recordingId);

    const comments = await hydrateCommentAuthorNames(
      rows.map((c) => ({
        id: c.id,
        recordingId: c.recordingId,
        threadId: c.threadId,
        parentId: c.parentId,
        authorEmail: c.authorEmail,
        authorName: c.authorName,
        content: c.content,
        mentions: displayCommentMentions(c.mentions),
        videoTimestampMs: c.videoTimestampMs,
        emojiReactionsJson: c.emojiReactionsJson,
        resolved: c.resolved,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    );

    return { comments };
  },
});
