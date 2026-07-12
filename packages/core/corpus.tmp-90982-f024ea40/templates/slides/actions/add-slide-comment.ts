import { defineAction } from "@agent-native/core";
import {
  getRequestRunContext,
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js"; // ensure registerShareableResource runs

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] || email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export default defineAction({
  description:
    "Add a comment to a slide. Omit threadId to start a new thread; provide threadId to reply.",
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    slideId: z.string().describe("Slide ID"),
    content: z.string().describe("Comment text"),
    quotedText: z
      .string()
      .optional()
      .describe("Selected text this comment is anchored to"),
    threadId: z
      .string()
      .optional()
      .describe("Thread ID — omit to start a new thread"),
    parentId: z.string().optional().describe("Parent comment ID — for replies"),
  }),
  run: async (args) => {
    const { deckId, slideId, content, quotedText, parentId } = args;
    await assertAccess("deck", deckId, "viewer");

    const id = Math.random().toString(36).slice(2, 14);
    const threadId = args.threadId ?? id;
    const authorEmail = getRequestUserEmail();
    if (!authorEmail) throw new Error("no authenticated user");
    const authorName = getRequestRunContext()
      ? "AI Agent"
      : getRequestUserName()?.trim() || displayNameFromEmail(authorEmail);

    const db = getDb();
    await db.insert(schema.slideComments).values({
      id,
      deckId,
      slideId,
      threadId,
      parentId: parentId ?? null,
      content,
      quotedText: quotedText ?? null,
      authorEmail,
      authorName,
    });

    return { id, threadId };
  },
});
