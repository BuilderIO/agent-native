/**
 * Get a single document by ID.
 *
 * Usage:
 *   pnpm script get-document --id abc123
 *   pnpm script get-document --id abc123 --format json
 *
 * Options:
 *   --id      Document ID (required)
 *   --format  Output format: "text" (default) or "json"
 */

import { parseArgs, fail } from "./_utils.js";
import { getDbExec } from "@agent-native/core/db";

export default async function main(args: string[]) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log("Usage: pnpm script get-document --id <id> [--format json]");
    console.log("Gets a single document by ID with full content.");
    return;
  }

  const id = opts.id;
  if (!id) fail("--id is required");

  const client = getDbExec();
  const result = await client.execute({
    sql: "SELECT id, parent_id, title, content, icon, position, is_favorite, created_at, updated_at FROM documents WHERE id = ?",
    args: [id],
  });

  if (!result.rows || result.rows.length === 0) {
    console.log(`Document "${id}" not found.`);
    return;
  }

  const doc = result.rows[0] as any;

  if (opts.format === "json") {
    console.log(JSON.stringify(doc, null, 2));
    return;
  }

  const icon = doc.icon ? `${doc.icon} ` : "";
  const fav = doc.is_favorite ? " [favorite]" : "";
  console.log(`${icon}${doc.title || "Untitled"}${fav}`);
  console.log(`ID: ${doc.id}`);
  if (doc.parent_id) console.log(`Parent: ${doc.parent_id}`);
  console.log(`Updated: ${doc.updated_at}`);
  console.log(`---`);
  console.log(doc.content || "(empty)");
}
