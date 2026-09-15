import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js"; // ensure registerShareableResource runs
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
      .optional()
      .describe("Existing thread ID for a reply; omit to start a new thread"),
    parentId: z
      .string()
      .optional()
      .describe("Parent comment ID for a reply; requires threadId"),
  })
  .refine((args) => !args.parentId || args.threadId, {
    message: "A parent comment requires an existing thread ID",
    path: ["threadId"],
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
      threadId: requestedThreadId,
      parentId,
    } = args;
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
    const [deck] = await db
      .select({ data: schema.decks.data })
      .from(schema.decks)
      .where(eq(schema.decks.id, deckId))
      .limit(1);
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
      const [thread] = await db
        .select({ resolved: schema.slideComments.resolved })
        .from(schema.slideComments)
        .where(
          and(
            eq(schema.slideComments.deckId, deckId),
            eq(schema.slideComments.slideId, slideId),
            eq(schema.slideComments.threadId, requestedThreadId),
          ),
        )
        .limit(1);
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

      if (parentId) {
        const [parent] = await db
          .select({ id: schema.slideComments.id })
          .from(schema.slideComments)
          .where(
            and(
              eq(schema.slideComments.id, parentId),
              eq(schema.slideComments.deckId, deckId),
              eq(schema.slideComments.slideId, slideId),
              eq(schema.slideComments.threadId, requestedThreadId),
            ),
          )
          .limit(1);
        if (!parent) {
          fail("Parent comment not found in this thread", {
            errorCode: "not_found",
            statusCode: 404,
          });
        }
      }
    }

    await db.insert(schema.slideComments).values({
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

    const notified = await notifyDeckComment({
      deckId,
      slideId,
      threadId,
      authorEmail,
      authorName,
      content,
      isReply: Boolean(parentId ?? args.threadId),
    });

    return { id, threadId, notified };
  },
});
