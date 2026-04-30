import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

export default defineAction({
  description: "Add a comment to a document. For new threads, omit threadId.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID (required)"),
    content: z.string().optional().describe("Comment text (required)"),
    threadId: z.string().optional().describe("Thread ID (for replies)"),
    parentId: z.string().optional().describe("Parent comment ID (for replies)"),
    quotedText: z.string().optional().describe("Quoted text for the thread"),
  }),
  run: async (args) => {
    const documentId = args.documentId;
    const content = args.content;
    if (!documentId) throw new Error("--documentId is required");
    if (!content) throw new Error("--content is required");

    const client = getDbExec();
    const access = await assertAccess("document", documentId, "viewer");
    const ownerEmail = access.resource.ownerEmail as string;
    const id = Math.random().toString(36).slice(2, 14);
    const threadId = args.threadId ?? id;
    const parentId = args.parentId ?? null;
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const name = "AI Agent";

    const nowExpr = isPostgres() ? "NOW()::text" : "datetime('now')";
    await client.execute({
      sql: `INSERT INTO document_comments (id, owner_email, document_id, thread_id, parent_id, content, quoted_text, author_email, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowExpr}, ${nowExpr})`,
      args: [
        id,
        ownerEmail,
        documentId,
        threadId,
        parentId,
        content,
        args.quotedText ?? null,
        email,
        name,
      ],
    });

    console.log(`Comment added (thread: ${threadId})`);
    return { id, threadId };
  },
});
