import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { ReviewCommentRevisionConflictError } from "@agent-native/core/review";
import updateReviewComment from "@agent-native/core/review/actions/update-review-comment";
import { ForbiddenError } from "@agent-native/core/sharing";
import { z } from "zod";

import { assertCommentAccess } from "../server/lib/comment-access.js";
import { resolveCommentMentions } from "../server/lib/comment-mentions.js";
import {
  clipsMentions,
  findRecordingComment,
  kitMentions,
  RECORDING_REVIEW_RESOURCE,
  recordingReviewContext,
} from "../server/lib/recording-comments.js";
import { sameOwnerEmail } from "../server/lib/recordings.js";
import {
  displayCommentMentions,
  mentionsForCommentText,
} from "../shared/comment-mentions.js";

const mentionSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1),
});

export default defineAction({
  description:
    "Update a comment's text. Inline Markdown is supported without headings. Only the comment author can edit it.",
  schema: z.object({
    id: z.string().describe("Comment ID"),
    content: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Updated comment text; inline Markdown is supported, without headings",
      ),
    mentions: z
      .union([z.string(), z.array(mentionSchema).max(20)])
      .optional()
      .describe("Organization members mentioned in the updated comment"),
  }),
  mcpTool: "search",
  run: async (args, ctx) => {
    const reviewCtx = recordingReviewContext(ctx);
    const userEmail = reviewCtx.userEmail;
    if (!userEmail) {
      throw new Error("Sign in required to edit comments.");
    }

    const existing = await findRecordingComment(args.id);
    if (!existing) throw new Error(`Comment not found: ${args.id}`);

    const access = await assertCommentAccess(
      existing.resourceId,
      "write",
      ctx?.requestHeaders,
    );

    if (!sameOwnerEmail(existing.authorEmail, userEmail)) {
      throw new ForbiddenError(
        "Only the comment author can edit this comment.",
      );
    }

    const recording = access.resource as { organizationId: string | null };
    const mentions = await resolveCommentMentions(
      args.mentions === undefined
        ? mentionsForCommentText(args.content, clipsMentions(existing.mentions))
        : args.mentions,
      recording.organizationId ?? "",
    );

    const updated = await Promise.resolve(
      updateReviewComment.run(
        {
          resourceType: RECORDING_REVIEW_RESOURCE,
          resourceId: existing.resourceId,
          commentId: existing.id,
          body: args.content,
          mentions: kitMentions(mentions),
          ...(existing.revision ? { expectedRevision: existing.revision } : {}),
        },
        reviewCtx,
      ),
    ).catch((error: unknown) => {
      if (error instanceof ReviewCommentRevisionConflictError) {
        fail(
          `Comment ${args.id} changed before this edit could be saved. Refresh and try again.`,
          { errorCode: "comment_changed", statusCode: 409 },
        );
      }
      throw error;
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      id: args.id,
      content: updated.body,
      mentions: displayCommentMentions(clipsMentions(updated.mentions)),
      updatedAt: updated.updatedAt,
    };
  },
});
