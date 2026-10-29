import { defineAction, fail } from "@agent-native/core/action";
import { getReviewCommentById } from "@agent-native/core/review";
import createReviewComment from "@agent-native/core/review/actions/create-review-comment";
import replyReviewComment from "@agent-native/core/review/actions/reply-review-comment";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  assertSlideReviewAccess,
  slideReviewActionContext,
} from "../server/lib/slide-review-legacy.js";
import { slideCommentAnchorSchema } from "../shared/slide-comment-anchor.js";
import {
  SLIDE_REVIEW_RESOURCE_TYPE,
  slideReviewAnchor,
} from "../shared/slide-review.js";

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
    'Deprecated: use create-review-comment or reply-review-comment with resourceType "deck". Adds a comment to a slide, or replies to a thread on that slide, in the deck\'s review threads. Inline Markdown supports emphasis, inline code, links, and line breaks; headings are flattened.',
  schema: addSlideCommentSchema,
  changeResource: ({ deckId }) => ({
    resourceType: "deck",
    resourceId: deckId,
  }),
  run: async (args, ctx) => {
    const { deckId, slideId, content, quotedText, anchor } = args;
    const threadId = args.threadId?.trim();
    const parentId = args.parentId?.trim();
    if (Boolean(threadId) !== Boolean(parentId)) {
      fail("threadId and parentId must be supplied together and non-empty", {
        errorCode: "invalid_comment_relationship",
        statusCode: 400,
      });
    }
    await assertSlideReviewAccess(deckId, ctx, "commenter");
    await assertSlideInDeck(deckId, slideId);
    const reviewCtx = slideReviewActionContext(ctx);
    if (parentId) {
      const parent = await getReviewCommentById(
        parentId,
        {},
        { bypassScope: true },
      );
      if (
        !parent ||
        parent.resourceId !== deckId ||
        parent.threadId !== threadId ||
        parent.targetId !== slideId
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
    }

    const created = parentId
      ? await replyReviewComment.run(
          {
            resourceType: SLIDE_REVIEW_RESOURCE_TYPE,
            resourceId: deckId,
            commentId: parentId,
            body: content.trim(),
          },
          reviewCtx,
        )
      : await createReviewComment.run(
          {
            resourceType: SLIDE_REVIEW_RESOURCE_TYPE,
            resourceId: deckId,
            targetId: slideId,
            anchor: slideReviewAnchor({ slideId, quotedText, point: anchor }),
            body: content.trim(),
            resolutionTarget: "human",
          },
          reviewCtx,
        );
    return {
      id: created.id,
      threadId: created.threadId,
      notified: created.notified,
    };
  },
});

async function assertSlideInDeck(deckId: string, slideId: string) {
  const deck = (await assertAccess("deck", deckId, "commenter")).resource as {
    data: string;
  };
  const slides = (JSON.parse(deck.data) as { slides?: unknown } | null)?.slides;
  if (!Array.isArray(slides)) {
    // guard:allow-bare-error — invariant: every deck write stores a slides array.
    throw new Error(`Deck has invalid slide data: ${deckId}`);
  }
  if (
    !slides.some(
      (slide) =>
        Boolean(slide) &&
        typeof slide === "object" &&
        (slide as { id?: unknown }).id === slideId,
    )
  ) {
    fail(`Slide not found in deck: ${slideId}`, {
      errorCode: "not_found",
      statusCode: 404,
    });
  }
}
