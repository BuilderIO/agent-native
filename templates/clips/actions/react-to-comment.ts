import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { listReviewCommentReactors } from "@agent-native/core/review";
import reactToReviewComment from "@agent-native/core/review/actions/react-to-review-comment";
import { z } from "zod";

import { notifyRecordingReaction } from "../server/lib/activity-notifications.js";
import { assertCommentAccess } from "../server/lib/comment-access.js";
import {
  commentVideoTimestampMs,
  findRecordingComment,
  RECORDING_REVIEW_RESOURCE,
  recordingReviewContext,
} from "../server/lib/recording-comments.js";

export default defineAction({
  description:
    "Toggle the current user's emoji reaction on a comment. Calling with the same emoji twice removes the reaction.",
  schema: z.object({
    commentId: z.string().describe("Comment ID"),
    emoji: z.string().min(1).describe("Emoji character (e.g. 👍, ❤️, 🔥)"),
  }),
  mcpTool: "search",
  run: async (args, ctx) => {
    const reviewCtx = recordingReviewContext(ctx);
    const viewerEmail = reviewCtx.userEmail;
    if (!viewerEmail) {
      throw new Error("Sign in required to react to comments.");
    }

    const existing = await findRecordingComment(args.commentId);
    if (!existing) {
      fail(`Comment not found: ${args.commentId}`, {
        errorCode: "comment_not_found",
        statusCode: 404,
      });
    }

    await assertCommentAccess(
      existing.resourceId,
      "write",
      ctx?.requestHeaders,
    );

    const { active } = await reactToReviewComment.run(
      {
        resourceType: RECORDING_REVIEW_RESOURCE,
        resourceId: existing.resourceId,
        commentId: existing.id,
        reaction: args.emoji,
      },
      reviewCtx,
    );
    const reactors = await listReviewCommentReactors([existing.id]);
    // coercion-ok: the kit answers every comment it is asked about, so this default never applies.
    const reactions = reactors[existing.id] ?? {};

    const notified = active
      ? await notifyRecordingReaction({
          recordingId: existing.resourceId,
          emoji: args.emoji,
          viewerEmail,
          videoTimestampMs: commentVideoTimestampMs(existing.anchor),
          extraRecipients: [existing.authorEmail],
        })
      : null;

    await writeAppState("refresh-signal", { ts: Date.now() });
    return {
      id: args.commentId,
      emoji: args.emoji,
      reacted: active,
      reactions,
      notified,
    };
  },
});
