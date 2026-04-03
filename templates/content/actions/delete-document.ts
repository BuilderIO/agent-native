/**
 * Delete a document and all its children recursively.
 *
 * Usage:
 *   pnpm action delete-document --id abc123
 *
 * Options:
 *   --id    Document ID (required)
 */

import { parseArgs, fail } from "./_utils.js";
import { getDbExec } from "@agent-native/core/db";
import { writeAppState } from "@agent-native/core/application-state";

async function collectDescendants(
  client: ReturnType<typeof getDbExec>,
  parentId: string,
): Promise<string[]> {
  const result = await client.execute({
    sql: "SELECT id FROM documents WHERE parent_id = ?",
    args: [parentId],
  });
  const ids: string[] = [];
  for (const row of result.rows || []) {
    const childId = (row as any).id;
    ids.push(childId);
    const grandchildren = await collectDescendants(client, childId);
    ids.push(...grandchildren);
  }
  return ids;
}

export default async function main(args: string[]) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log("Usage: pnpm action delete-document --id <id>");
    console.log("Deletes a document and all its children recursively.");
    return;
  }

  const id = opts.id;
  if (!id) fail("--id is required");

  const client = getDbExec();

  // Verify document exists
  const existing = await client.execute({
    sql: "SELECT id, title FROM documents WHERE id = ?",
    args: [id],
  });
  if (!existing.rows || existing.rows.length === 0) {
    fail(`Document "${id}" not found`);
  }

  const title = (existing.rows[0] as any).title || "Untitled";

  // Collect all descendant IDs
  const descendants = await collectDescendants(client, id);
  const allIds = [id, ...descendants];

  // Delete sync links for all documents
  for (const docId of allIds) {
    await client.execute({
      sql: "DELETE FROM document_sync_links WHERE document_id = ?",
      args: [docId],
    });
  }

  // Delete document versions for all documents
  for (const docId of allIds) {
    await client.execute({
      sql: "DELETE FROM document_versions WHERE document_id = ?",
      args: [docId],
    });
  }

  // Delete all documents (children first, then parent)
  for (const docId of allIds.reverse()) {
    await client.execute({
      sql: "DELETE FROM documents WHERE id = ?",
      args: [docId],
    });
  }

  // Trigger UI refresh
  await writeAppState("refresh-signal", { ts: Date.now() });

  console.log(
    `Deleted "${title}" (${id})` +
      (descendants.length > 0
        ? ` and ${descendants.length} child document(s)`
        : ""),
  );
}
