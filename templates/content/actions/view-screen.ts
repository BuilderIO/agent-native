/**
 * See what the user is currently looking at on screen.
 *
 * Reads navigation state and fetches matching data — either the document tree
 * (list view) or a specific document's content (editor view).
 *
 * Usage:
 *   pnpm action view-screen
 */

import { parseArgs } from "./_utils.js";
import { readAppState } from "@agent-native/core/application-state";
import { getDbExec } from "@agent-native/core/db";

export default async function main(args: string[]) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log("Usage: pnpm action view-screen");
    console.log("Shows what the user is currently looking at.");
    return;
  }

  const navigation = await readAppState("navigation");

  const screen: Record<string, unknown> = {};
  if (navigation) screen.navigation = navigation;

  const nav = navigation as any;
  const client = getDbExec();

  if (nav?.documentId) {
    // User is viewing a specific document
    const result = await client.execute({
      sql: "SELECT id, parent_id, title, content, icon, position, is_favorite, created_at, updated_at FROM documents WHERE id = ?",
      args: [nav.documentId],
    });
    if (result.rows && result.rows.length > 0) {
      screen.document = result.rows[0];
    }
  }

  // Always include the document tree for context
  const treeResult = await client.execute({
    sql: "SELECT id, parent_id, title, icon, position, is_favorite FROM documents ORDER BY position",
    args: [],
  });
  const docs = (treeResult.rows || []) as any[];

  if (docs.length > 0) {
    screen.documentTree = {
      count: docs.length,
      items: docs.map((d: any) => ({
        id: d.id,
        parentId: d.parent_id,
        title: d.title || "Untitled",
        icon: d.icon || undefined,
        isFavorite: d.is_favorite === 1,
      })),
    };
  }

  if (Object.keys(screen).length === 0) {
    console.log("No application state found. Is the app running?");
    return;
  }

  const docCount = docs.length;
  console.error(
    `Current view: ${nav?.view ?? "list"}` +
      (nav?.documentId ? ` (document: ${nav.documentId})` : "") +
      ` — ${docCount} document(s) total`,
  );
  console.log(JSON.stringify(screen, null, 2));
}
