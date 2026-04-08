/**
 * Add a comment to a document.
 *
 * Usage:
 *   pnpm action add-comment --documentId abc123 --content "This needs review"
 *   pnpm action add-comment --documentId abc123 --threadId xyz --content "I agree"
 */

import { parseArgs, fail } from "./_utils.js";
import { getDbExec, isPostgres } from "@agent-native/core/db";

export default async function main(args: string[]) {
  const opts = parseArgs(args);
  const documentId = opts.documentId;
  const content = opts.content;
  if (!documentId) fail("--documentId is required");
  if (!content) fail("--content is required");

  const client = getDbExec();
  const id = Math.random().toString(36).slice(2, 14);
  const threadId = opts.threadId ?? id;
  const parentId = opts.parentId ?? null;
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
      opts.quotedText ?? null,
      email,
      name,
    ],
  });

  console.log(`Comment added (thread: ${threadId})`);
}
