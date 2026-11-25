import {
  defineAction,
  fail,
  isOutsideAgentCall,
} from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import deleteReviewComment from "@agent-native/core/review/actions/delete-review-comment";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { z } from "zod";

import { assertCommentAccess } from "../server/lib/comment-access.js";
import {
  commentDeleteContext,
  findRecordingComment,
  RECORDING_REVIEW_RESOURCE,
  recordingKitComments,
} from "../server/lib/recording-comments.js";
import { sameOwnerEmail } from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Delete a comment. Only the author or an editor/admin on the recording can delete. Deleting a thread's first comment deletes the whole thread, which needs editor access when it holds anyone else's reply; deleting a reply deletes only that reply.",
  schema: z.object({
    id: z.string().describe("Comment ID"),
  }),
  needsApproval: (_args, ctx) => isOutsideAgentCall(ctx),
  mcpTool: "search",
  run: async (args, ctx) => {
    const existing = await findRecordingComment(args.id);
    if (!existing) throw new Error(`Comment not found: ${args.id}`);

    const reviewCtx = commentDeleteContext(ctx);
    const isAuthor = sameOwnerEmail(existing.authorEmail, reviewCtx.userEmail);

    await assertCommentAccess(
      existing.resourceId,
      "delete",
      ctx?.requestHeaders,
    );

    if (!isAuthor) {
      try {
        await assertAccess("recording", existing.resourceId, "editor");
      } catch (err) {
        if (err instanceof ForbiddenError) {
          throw new ForbiddenError(
            "Only the comment author or a recording editor can delete this comment.",
          );
        }
        throw err;
      }
    }

    const removed = existing.parentCommentId
      ? [existing]
      : await recordingKitComments(existing.resourceId, existing.threadId);
    const threadHasAnotherFirst = removed.some(
      (comment) => comment.id !== existing.id && !comment.parentCommentId,
    );
    if (existing.threadId !== existing.id && threadHasAnotherFirst) {
      fail(
        "This reply isn't linked to its thread yet, so deleting it would delete the whole thread. Try again after Clips restarts.",
        { errorCode: "reply_not_linked", statusCode: 409 },
      );
    }

    await deleteReviewComment.run(
      {
        resourceType: RECORDING_REVIEW_RESOURCE,
        resourceId: existing.resourceId,
        commentId: existing.id,
      },
      reviewCtx,
    );

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Deleted comment ${args.id}`);
    return {
      id: args.id,
      deletedCommentIds: removed.map((comment) => comment.id),
    };
  },
});
