import { defineAction, fail } from "@agent-native/core/action";
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

    const id = Math.random().toString(36).slice(2, 14);
    const threadId = requestedThreadId ?? id;
    const authorEmail = getRequestUserEmail();
    if (!authorEmail) throw new Error("no authenticated user");
    const authorName =
      ctx?.caller === "tool"
        ? "AI Agent"
        : getRequestUserName()?.trim() || displayNameFromEmail(authorEmail);

    const db = getDb();
    await db.transaction(async (tx) => {
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
      const slides = (deckData as { slides?: unknown } | null)?.slides;
      if (!Array.isArray(slides)) {
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

      await tx.insert(schema.slideComments).values({
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
      });
    });

    const notified = await notifyDeckComment({
      deckId,
      slideId,
      threadId,
      authorEmail,
      authorName,
      content,
      isReply: requestedThreadId !== undefined,
    });

    return { id, threadId, notified };
  },
});
