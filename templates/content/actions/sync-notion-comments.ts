/**
 * Sync comments bidirectionally with Notion.
 *
 * Usage:
 *   pnpm action sync-notion-comments --documentId abc123
 *
 * Pulls new Notion comments and pushes local comments that don't have a Notion ID.
 */

import { parseArgs, fail } from "./_utils.js";
import { getDbExec, isPostgres } from "@agent-native/core/db";

export default async function main(args: string[]) {
  const opts = parseArgs(args);
  const documentId = opts.documentId;
  if (!documentId) fail("--documentId is required");

  // Lazy import to avoid loading Notion deps in non-Notion contexts
  const { getNotionConnectionForOwner, listNotionComments, addNotionComment } =
    await import("../server/lib/notion.js");
  const { getSyncLink } = await import("../server/lib/notion-sync.js");

  // Check if document is linked to Notion
  const syncLink = await getSyncLink(documentId);
  if (!syncLink) {
    console.log("Document is not linked to Notion. Link it first.");
    return;
  }

  const owner = process.env.AGENT_USER_EMAIL ?? "local@localhost";
  const connection = await getNotionConnectionForOwner(owner);
  if (!connection) {
    console.log("No Notion connection. Connect to Notion first.");
    return;
  }

  const notionPageId = syncLink.remotePageId;
  const accessToken = connection.accessToken;
  const client = getDbExec();

  // ── Pull: Notion → Local ──────────────────────────
  const notionComments = await listNotionComments(notionPageId, accessToken);
  let pulled = 0;

  for (const nc of notionComments) {
    const text = nc.rich_text.map((r) => r.plain_text).join("");
    if (!text) continue;

    // Check if already synced
    const { rows } = await client.execute({
      sql: "SELECT id FROM document_comments WHERE notion_comment_id = ?",
      args: [nc.id],
    });
    if (rows.length > 0) continue;

    // Create local comment
    const id = Math.random().toString(36).slice(2, 14);
    const nowExpr = isPostgres() ? "NOW()::text" : "datetime('now')";
    await client.execute({
      sql: `INSERT INTO document_comments (id, document_id, thread_id, parent_id, content, author_email, author_name, notion_comment_id, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ${nowExpr}, ${nowExpr})`,
      args: [id, documentId, id, text, "notion@sync", "Notion", nc.id],
    });
    pulled++;
  }

  // ── Push: Local → Notion ──────────────────────────
  const { rows: localComments } = await client.execute({
    sql: "SELECT id, content FROM document_comments WHERE document_id = ? AND notion_comment_id IS NULL AND resolved = 0",
    args: [documentId],
  });
  let pushed = 0;

  for (const lc of localComments) {
    const content = (lc as any).content;
    const localId = (lc as any).id;
    const notionId = await addNotionComment(notionPageId, content, accessToken);
    if (notionId) {
      await client.execute({
        sql: "UPDATE document_comments SET notion_comment_id = ? WHERE id = ?",
        args: [notionId, localId],
      });
      pushed++;
    }
  }

  console.log(
    `Synced comments: ${pulled} pulled from Notion, ${pushed} pushed to Notion`,
  );
}
