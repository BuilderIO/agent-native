import {
  defineAction,
  fail,
  type WriteReceipt,
} from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyDeckComment } from "../server/lib/comment-notifications.js";
import {
  serializeSlideCommentAnchor,
  slideCommentAnchorSchema,
} from "../shared/slide-comment-anchor.js";
import { assertSlides2DeckData } from "./_deck-app-scope.js";

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] || email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

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
        "Slide-positioned anchor. Version 1 source-backed anchors require sourceHash plus sourceLocator for a point or region for a dragged area; region anchors may also include the locator of their containing JSX element. x/y remain the slide-relative fallback, with optional objectX/objectY for point placement. Legacy HTML anchors may use objectId and object-relative percentages.",
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
    "Add a comment to a slide or reply to an existing thread on that same slide. Inline Markdown supports emphasis, inline code, links, and line breaks; headings are flattened. Anchors can target a slide position, a legacy HTML object, or a versioned React source location with an optional object-relative point or dragged region. Versioned anchors require the current source hash and always retain x/y as the fallback.",
  schema: addSlideCommentSchema,
  changeResource: ({ deckId }) => ({
    resourceType: "deck",
    resourceId: deckId,
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
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
    const authorEmail = getRequestUserEmail();
    if (!authorEmail) {
      fail("Sign in is required to add a comment.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    await assertAccess("deck", deckId, "commenter");

    const id = Math.random().toString(36).slice(2, 14);
    const threadId = requestedThreadId ?? id;
    const authorName =
      ctx?.caller === "tool"
        ? "AI Agent"
        : getRequestUserName()?.trim() || displayNameFromEmail(authorEmail);

    const db = getDb();
    const inserted = await db.transaction(async (tx) => {
      const [deck] = await tx
        .select({ id: schema.decks.id, data: schema.decks.data })
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId))
        .for("update");
      if (!deck) {
        fail(`Deck not found: ${deckId}`, {
          errorCode: "not_found",
          statusCode: 404,
        });
      }
      const deckData: unknown = JSON.parse(deck.data);
      assertSlides2DeckData(deckData);
      const slides = (deckData as { slides?: unknown } | null)?.slides;
      if (!Array.isArray(slides)) {
        throw new Error(`Deck has invalid slide data: ${deckId}`);
      }
      const targetSlide = slides.find(
        (slide) =>
          Boolean(slide) &&
          typeof slide === "object" &&
          (slide as { id?: unknown }).id === slideId,
      );
      if (!targetSlide) {
        fail(`Slide not found in deck: ${slideId}`, {
          errorCode: "not_found",
          statusCode: 404,
        });
      }
      if (anchor?.version === 1) {
        const sourceHash =
          typeof targetSlide === "object" && targetSlide !== null
            ? (targetSlide as { sourceHash?: unknown }).sourceHash
            : undefined;
        if (sourceHash !== anchor.sourceHash) {
          fail("Slide source changed before this comment could be anchored.", {
            errorCode: "slide_source_conflict",
            statusCode: 409,
          });
        }
      }

      if (requestedThreadId) {
        const threadRows = await tx
          .select({
            id: schema.slideComments.id,
            resolved: schema.slideComments.resolved,
          })
          .from(schema.slideComments)
          .where(
            and(
              eq(schema.slideComments.deckId, deckId),
              eq(schema.slideComments.slideId, slideId),
              eq(schema.slideComments.threadId, requestedThreadId),
            ),
          )
          .for("update");
        const thread = threadRows[0];
        if (!thread) {
          fail("Comment thread not found on this slide", {
            errorCode: "not_found",
            statusCode: 404,
          });
        }
        if (thread.resolved) {
          fail("Reopen this comment thread before replying", {
            errorCode: "comment_thread_resolved",
            statusCode: 409,
          });
        }

        if (!threadRows.some((row) => row.id === parentId)) {
          fail("Parent comment not found in this thread", {
            errorCode: "not_found",
            statusCode: 404,
          });
        }
      }

      const [savedComment] = await tx
        .insert(schema.slideComments)
        .values({
          id,
          deckId,
          slideId,
          threadId,
          parentId: parentId ?? null,
          content: content.trim(),
          quotedText: quotedText ?? null,
          anchor: serializeSlideCommentAnchor(anchor),
          authorEmail,
          authorName,
        })
        .returning({
          id: schema.slideComments.id,
          deckId: schema.slideComments.deckId,
          slideId: schema.slideComments.slideId,
          threadId: schema.slideComments.threadId,
          parentId: schema.slideComments.parentId,
          content: schema.slideComments.content,
        });

      if (
        !savedComment ||
        savedComment.id !== id ||
        savedComment.deckId !== deckId ||
        savedComment.slideId !== slideId ||
        savedComment.threadId !== threadId ||
        savedComment.parentId !== (parentId ?? null) ||
        savedComment.content !== content.trim()
      ) {
        fail("Could not verify that the comment was saved.", {
          errorCode: "write_not_verified",
          statusCode: 500,
        });
      }

      return savedComment;
    });

    const notified = await notifyDeckComment({
      deckId,
      slideId,
      threadId: inserted.threadId,
      authorEmail,
      authorName,
      content,
      isReply: inserted.parentId !== null,
    });

    const _receipt: WriteReceipt = {
      changed: true,
      verified: true,
      subject: inserted.id,
      summary: "Slide comment saved.",
      checks: [
        {
          id: "slide-comment",
          ok: true,
          detail: "The saved comment matches the request.",
        },
      ],
    };
    return { id: inserted.id, threadId: inserted.threadId, notified, _receipt };
  },
});
