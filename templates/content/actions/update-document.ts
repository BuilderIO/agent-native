/**
 * Update an existing document.
 *
 * Usage:
 *   pnpm action update-document --id abc123 --title "New Title"
 *   pnpm action update-document --id abc123 --content "# Updated content"
 *   pnpm action update-document --id abc123 --title "New" --content "New body"
 *   pnpm action update-document --id abc123 --icon "📝"
 *
 * Options:
 *   --id        Document ID (required)
 *   --title     New title
 *   --content   New markdown content
 *   --icon      New emoji icon
 */

import { parseArgs, fail } from "./_utils.js";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { writeAppState } from "@agent-native/core/application-state";

export default async function main(args: string[]) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(
      'Usage: pnpm action update-document --id <id> [--title "New Title"] [--content "# New"]',
    );
    return;
  }

  const id = opts.id;
  if (!id) fail("--id is required");

  if (!opts.title && !opts.content && !opts.icon) {
    fail("At least one of --title, --content, or --icon is required");
  }

  // Verify document exists
  const client = getDbExec();
  const existing = await client.execute({
    sql: "SELECT id FROM documents WHERE id = ?",
    args: [id],
  });
  if (!existing.rows || existing.rows.length === 0) {
    fail(`Document "${id}" not found`);
  }

  // Build SET clause dynamically
  const setClauses: string[] = [];
  const params: any[] = [];

  if (opts.title !== undefined) {
    setClauses.push("title = ?");
    params.push(opts.title);
  }
  if (opts.content !== undefined) {
    setClauses.push("content = ?");
    params.push(opts.content);
  }
  if (opts.icon !== undefined) {
    setClauses.push("icon = ?");
    params.push(opts.icon);
  }

  const nowExpr = isPostgres() ? "NOW()::text" : "datetime('now')";
  setClauses.push(`updated_at = ${nowExpr}`);

  params.push(id);

  await client.execute({
    sql: `UPDATE documents SET ${setClauses.join(", ")} WHERE id = ?`,
    args: params,
  });

  // Trigger UI refresh
  await writeAppState("refresh-signal", { ts: Date.now() });

  const updated: string[] = [];
  if (opts.title) updated.push(`title="${opts.title}"`);
  if (opts.content) updated.push("content");
  if (opts.icon) updated.push(`icon="${opts.icon}"`);
  console.log(`Updated document ${id}: ${updated.join(", ")}`);
}
