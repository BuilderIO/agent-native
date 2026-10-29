import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  assertSlideReviewAccess,
  listSlideReviewComments,
} from "../server/lib/slide-review-legacy.js";
import { parseSlideReviewAnchor } from "../shared/slide-review.js";

const MAX_BODY_CHARS = 1_000;

export default defineAction({
  description:
    "Read a deck's review threads grouped by slide, in slide order: each thread's id, root comment id, status, who it is waiting on, where on the slide it points, and its comments. Use it to work through comments; reply with reply-review-comment and resolve with resolve-review-thread (resourceType \"deck\", resourceId = deckId). Open threads only unless includeResolved is true.",
  readOnly: true,
  http: { method: "GET" },
  schema: z.object({
    deckId: z.string().min(1).describe("Deck ID"),
    slideId: z.string().optional().describe("Only this slide's threads"),
    includeResolved: z.boolean().optional(),
  }),
  outputSchema: z.object({
    deckId: z.string(),
    threads: z.array(
      z.object({
        threadId: z.string(),
        rootCommentId: z.string(),
        status: z.enum(["open", "resolved", "deleted"]),
        waitingOn: z.enum(["agent", "human"]).nullable(),
        slideId: z.string().nullable(),
        slideNumber: z.number().nullable(),
        quotedText: z.string().nullable(),
        objectId: z.string().nullable(),
        targetText: z.string().nullable(),
        comments: z.array(
          z.object({
            commentId: z.string(),
            author: z.string().nullable(),
            fromAgent: z.boolean(),
            body: z.string(),
            createdAt: z.string(),
          }),
        ),
      }),
    ),
    truncated: z
      .boolean()
      .describe("True when the deck has more comments than one read returns"),
  }),
  run: async (args, ctx) => {
    await assertSlideReviewAccess(args.deckId, ctx, "viewer");
    const deck = (await assertAccess("deck", args.deckId, "viewer"))
      .resource as { data: string };
    const slides = (JSON.parse(deck.data) as { slides?: { id?: string }[] })
      .slides;
    if (!Array.isArray(slides)) {
      // guard:allow-bare-error — invariant: every deck write stores a slides array.
      throw new Error(`Deck has invalid slide data: ${args.deckId}`);
    }
    const slideNumbers = new Map(
      slides.map((slide, index) => [slide.id, index + 1] as const),
    );
    const { comments, truncated } = await listSlideReviewComments(
      args.deckId,
      ctx,
      {
        slideId: args.slideId,
      },
    );
    const roots = comments.filter(
      (comment) =>
        comment.parentCommentId === null &&
        (args.includeResolved || comment.status === "open"),
    );
    const threads = roots.map((root) => {
      const anchor = parseSlideReviewAnchor(root.anchor);
      const slideId = anchor?.slideId ?? root.targetId;
      return {
        threadId: root.threadId,
        rootCommentId: root.id,
        status: root.status,
        waitingOn: root.resolutionTarget,
        slideId,
        slideNumber: (slideId && slideNumbers.get(slideId)) || null,
        quotedText: anchor?.quotedText ?? null,
        objectId: anchor?.point?.objectId ?? null,
        targetText: anchor?.point?.targetText ?? null,
        comments: comments
          .filter((comment) => comment.threadId === root.threadId)
          .map((comment) => ({
            commentId: comment.id,
            author: comment.authorName ?? comment.authorEmail ?? null,
            fromAgent: comment.createdBy === "agent",
            body: comment.body.slice(0, MAX_BODY_CHARS),
            createdAt: comment.createdAt,
          })),
      };
    });
    threads.sort(
      (left, right) =>
        (left.slideNumber ?? Number.MAX_SAFE_INTEGER) -
        (right.slideNumber ?? Number.MAX_SAFE_INTEGER),
    );
    return {
      deckId: args.deckId,
      threads,
      // The deck has more comments than one read returns; newer threads are
      // missing. Use list-review-comments with targetId per slide to reach them.
      truncated,
    };
  },
});
