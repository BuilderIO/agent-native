import { defineAction } from "@agent-native/core";
import { getDbExec, isPostgres } from "@agent-native/core/db";

export default defineAction({
  description: "Add a comment to a document. For new threads, omit threadId.",
  parameters: {
    documentId: { type: "string", description: "Document ID (required)" },
    content: { type: "string", description: "Comment text (required)" },
    threadId: { type: "string", description: "Thread ID (for replies)" },
    parentId: {
      type: "string",
      description: "Parent comment ID (for replies)",
    },
    quotedText: { type: "string", description: "Quoted text for the thread" },
  },
  run: async (args) => {
    const documentId = args.documentId;
    const content = args.content;
    if (!documentId) throw new Error("--documentId is required");
    if (!content) throw new Error("--content is required");

    const client = getDbExec();
    const id = Math.random().toString(36).slice(2, 14);
    const threadId = args.threadId ?? id;
    const parentId = args.parentId ?? null;
    const email = process.env.AGENT_USER_EMAIL ?? "agent@localhost";
    const name = "AI Agent";

    const nowExpr = isPostgres() ? "NOW()::text" : "datetime('now')";
    await client.execute({
      sql: `INSERT INTO document_comments (id, document_id, thread_id, parent_id, content, quoted_text, author_email, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${nowExpr}, ${nowExpr})`,
      args: [
        id,
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
