/**
 * List comments on a document.
 *
 * Usage:
 *   pnpm action list-comments --documentId abc123
 */

import { parseArgs, fail } from "./_utils.js";
import { getDbExec } from "@agent-native/core/db";

export default async function main(args: string[]) {
  const opts = parseArgs(args);
  const documentId = opts.documentId;
  if (!documentId) fail("--documentId is required");

  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT id, thread_id, parent_id, content, quoted_text, author_email, author_name, resolved, created_at FROM document_comments WHERE document_id = ? ORDER BY created_at ASC`,
    args: [documentId],
  });

  if (rows.length === 0) {
    console.log("No comments on this document.");
    return;
  }

  // Group by thread
  const threads = new Map<string, any[]>();
  for (const row of rows) {
    const tid = (row as any).thread_id;
    if (!threads.has(tid)) threads.set(tid, []);
    threads.get(tid)!.push(row);
  }

  console.log(`${threads.size} comment thread(s):\n`);
  for (const [threadId, comments] of threads) {
    const first = comments[0] as any;
    const status = first.resolved ? "[RESOLVED]" : "[OPEN]";
    if (first.quoted_text) {
      console.log(`${status} Thread on: "${first.quoted_text}"`);
    } else {
      console.log(`${status} Thread ${threadId}`);
    }
    for (const c of comments) {
      const author = (c as any).author_name || (c as any).author_email;
      const indent = (c as any).parent_id ? "    " : "  ";
      console.log(`${indent}${author}: ${(c as any).content}`);
    }
    console.log();
  }
}
