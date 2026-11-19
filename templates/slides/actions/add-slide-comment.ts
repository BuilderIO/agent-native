import { defineAction, fail } from "@agent-native/core/action";
import createReviewComment from "@agent-native/core/review/actions/create-review-comment";
import replyReviewComment from "@agent-native/core/review/actions/reply-review-comment";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  DECK_REVIEW_RESOURCE,
  findSlideComment,
  SLIDE_POINT_ANCHOR,
  slideCommentAuthorName,
  slideReviewContext,
} from "../server/lib/slide-comments.js";
import { slideCommentAnchorSchema } from "../shared/slide-comment-anchor.js";

const addSlideCommentSchema = z
  .object({
    deckId: z.string().describe("Deck ID"),
    slideId: z.string().describe("Slide ID"),
    content: z.string().trim().min(1).describe("Comment text"),
    quotedText: z
      .string()
      .optional()
      .describe("Selected text this comment is anchored to"),
    anchor: slideCommentAnchorSchema
      .optional()
      .describe(
        "Slide-positioned anchor with optional stable object ID and object-relative percentages",
      ),
    threadId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Existing thread ID for a reply; omit to start a new thread"),
    parentId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Parent comment ID for a reply; requires threadId"),
  })
  .superRefine((args, ctx) => {
    if (Boolean(args.threadId) !== Boolean(args.parentId)) {
      ctx.addIssue({
        code: "custom",
        message: "threadId and parentId must be supplied together",
        path: [args.threadId ? "parentId" : "threadId"],
      });
    }
  });

export default defineAction({
  description:
    "Add a comment to a slide or reply to an existing thread on that same slide. Inline Markdown supports emphasis, inline code, links, and line breaks; headings are flattened. Comments may be anchored to slide positions or stable slide objects.",
  schema: addSlideCommentSchema,
  changeResource: ({ deckId }) => ({
    resourceType: "deck",
    resourceId: deckId,
  }),
  audit: {
    target: (_args, result) => ({
      type: "slide-comment",
      id: (result as { id: string }).id,
    }),
  },
  run: async (args, ctx) => {
    const {
      deckId,
      slideId,
      content,
      quotedText,
      anchor,
      threadId: rawThreadId,
      parentId: rawParentId,
    } = args;
    const requestedThreadId = rawThreadId?.trim();
    const parentId = rawParentId?.trim();
    const hasThreadId = rawThreadId !== undefined;
    const hasParentId = rawParentId !== undefined;
    if (
      (hasThreadId && !requestedThreadId) ||
      (hasParentId && !parentId) ||
      hasThreadId !== hasParentId
    ) {
      fail("threadId and parentId must be supplied together and non-empty", {
        errorCode: "invalid_comment_relationship",
        statusCode: 400,
      });
    }
    await assertAccess("deck", deckId, "commenter");

    const reviewCtx = slideReviewContext(ctx);
    const authorEmail = reviewCtx.userEmail;
    if (!authorEmail) {
      fail("Sign in required to comment.", {
        errorCode: "not_authenticated",
        statusCode: 401,
      });
    }
    const shared = {
      resourceType: DECK_REVIEW_RESOURCE,
      resourceId: deckId,
      body: content,
      authorName: slideCommentAuthorName(ctx, authorEmail),
      ...(quotedText ? { metadata: { quotedText } } : {}),
    };

    if (requestedThreadId && parentId) {
      const parent = await findSlideComment(deckId, parentId);
      if (
        !parent ||
        parent.threadId !== requestedThreadId ||
        parent.surfaceId !== slideId
      ) {
        fail("Parent comment not found in this thread", {
          errorCode: "not_found",
          statusCode: 404,
        });
      }
      if (parent.status === "resolved") {
        fail("Reopen this comment thread before replying", {
          errorCode: "comment_thread_resolved",
          statusCode: 409,
        });
      }
      const reply = await replyReviewComment.run(
        { ...shared, commentId: parent.id },
        reviewCtx,
      );
      return {
        id: reply.id,
        threadId: reply.threadId,
        notified: reply.notified,
      };
    }

    const comment = await createReviewComment.run(
      {
        ...shared,
        surfaceId: slideId,
        anchor: anchor ?? null,
        anchorKind: anchor ? SLIDE_POINT_ANCHOR : null,
      },
      reviewCtx,
    );
    return {
      id: comment.id,
      threadId: comment.threadId,
      notified: comment.notified,
    };
  },
});
