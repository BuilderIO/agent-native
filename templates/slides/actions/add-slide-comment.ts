import { defineAction } from "@agent-native/core";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

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
    const client = getDbExec();
    const id = Math.random().toString(36).slice(2, 14);
    const threadId = args.threadId ?? id;
    const authorEmail = getRequestUserEmail() ?? "agent@localhost";
    const authorName = "AI Agent";

    const nowExpr = isPostgres() ? "NOW()::text" : "datetime('now')";
    await client.execute({
      sql: `INSERT INTO slide_comments (id, deck_id, slide_id, thread_id, parent_id, content, quoted_text, author_email, author_name, resolved, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ${nowExpr}, ${nowExpr})`,
      args: [
        id,
        deckId,
        slideId,
        threadId,
        parentId ?? null,
        content,
        quotedText ?? null,
        authorEmail,
        authorName,
      ],
    });

    return { id, threadId };
  },
});
