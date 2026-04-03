/**
 * Create a new document.
 *
 * Usage:
 *   pnpm action create-document --title "My Page"
 *   pnpm action create-document --title "My Page" --content "# Hello"
 *   pnpm action create-document --title "Sub Page" --parentId parent123
 *   pnpm action create-document --title "Notes" --icon "📝"
 *
 * Options:
 *   --title     Document title (required)
 *   --content   Markdown content (default: empty)
 *   --parentId  Parent document ID for nesting
 *   --icon      Emoji icon
 */

import { parseArgs, fail } from "./_utils.js";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { writeAppState } from "@agent-native/core/application-state";
import crypto from "node:crypto";

export default async function main(args: string[]) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(
      'Usage: pnpm action create-document --title "My Page" [--content "# Hello"] [--parentId id] [--icon "📝"]',
    );
    return;
  }

  const title = opts.title;
  if (!title) fail("--title is required");

  const id = crypto.randomBytes(6).toString("hex");
  const content = opts.content || "";
  const parentId = opts.parentId || null;
  const icon = opts.icon || null;
  const now = new Date().toISOString();

  // Get the next position within the parent
  const client = getDbExec();
  const posResult = await client.execute({
    sql:
      "SELECT MAX(position) as max_pos FROM documents WHERE parent_id " +
      (parentId ? "= ?" : "IS NULL"),
    args: parentId ? [parentId] : [],
  });
  const maxPos = (posResult.rows?.[0] as any)?.max_pos ?? -1;
  const position = (typeof maxPos === "number" ? maxPos : -1) + 1;

  const nowExpr = isPostgres() ? "NOW()::text" : "datetime('now')";

  await client.execute({
    sql: `INSERT INTO documents (id, parent_id, title, content, icon, position, is_favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ${nowExpr}, ${nowExpr})`,
    args: [id, parentId, title, content, icon, position],
  });

  // Trigger UI refresh
  await writeAppState("refresh-signal", { ts: Date.now() });

  console.log(`Created document "${title}" (${id})`);
  if (parentId) console.log(`  Parent: ${parentId}`);
  console.log(JSON.stringify({ id, title, parentId }, null, 2));
}
