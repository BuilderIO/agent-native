/**
 * Surgically edit document content using search-and-replace.
 *
 * Preferred over `update-document --content` for modifications — sends only
 * the changed text instead of regenerating the entire document.
 *
 * Usage:
 *   pnpm action edit-document --id abc123 --find "old text" --replace "new text"
 *   pnpm action edit-document --id abc123 --find "delete me" --replace ""
 *   pnpm action edit-document --id abc123 --edits '[{"find":"old","replace":"new"}]'
 *
 * Options:
 *   --id        Document ID (required)
 *   --find      Text to find (single edit mode)
 *   --replace   Replacement text (single edit mode, default: "")
 *   --edits     JSON array of {find, replace} objects (batch mode)
 */

import { parseArgs, fail } from "./_utils.js";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { writeAppState } from "@agent-native/core/application-state";
import { hasCollabState } from "@agent-native/core/collab";

interface TextEdit {
  find: string;
  replace: string;
}

export default async function main(args: string[]) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(
      'Usage: pnpm action edit-document --id <id> --find "old text" --replace "new text"',
    );
    console.log(
      '       pnpm action edit-document --id <id> --edits \'[{"find":"old","replace":"new"}]\'',
    );
    return;
  }

  const id = opts.id;
  if (!id) fail("--id is required");

  // Parse edits from either --find/--replace or --edits JSON
  let edits: TextEdit[];

  if (opts.edits) {
    try {
      edits = JSON.parse(opts.edits);
      if (!Array.isArray(edits)) fail("--edits must be a JSON array");
    } catch (e: any) {
      fail(`Invalid --edits JSON: ${e.message}`);
    }
  } else if (opts.find !== undefined) {
    if (!opts.find) fail("--find cannot be empty");
    edits = [{ find: opts.find, replace: opts.replace ?? "" }];
  } else {
    fail("Either --find or --edits is required");
  }

  // Validate edits
  for (const edit of edits!) {
    if (!edit.find) fail("Each edit must have a non-empty 'find' field");
    if (edit.replace === undefined) edit.replace = "";
  }

  // Fetch current content
  const client = getDbExec();
  const existing = await client.execute({
    sql: "SELECT id, title, content FROM documents WHERE id = ?",
    args: [id],
  });
  if (!existing.rows || existing.rows.length === 0) {
    fail(`Document "${id}" not found`);
  }

  let content = (existing.rows[0] as any).content ?? "";
  const results: string[] = [];
  let changeCount = 0;

  // Apply edits sequentially
  for (const edit of edits!) {
    const idx = content.indexOf(edit.find);
    if (idx === -1) {
      results.push(
        `NOT FOUND: "${edit.find.slice(0, 60)}${edit.find.length > 60 ? "..." : ""}"`,
      );
      continue;
    }
    content =
      content.slice(0, idx) +
      edit.replace +
      content.slice(idx + edit.find.length);
    changeCount++;
    const action = edit.replace === "" ? "deleted" : "replaced";
    results.push(
      `${action}: "${edit.find.slice(0, 40)}${edit.find.length > 40 ? "..." : ""}"`,
    );
  }

  if (changeCount === 0) {
    console.log(
      "No edits applied — none of the find texts were found in the document.",
    );
    for (const r of results) console.log(`  - ${r}`);
    return;
  }

  // Write updated content to SQL
  const nowExpr = isPostgres() ? "NOW()::text" : "datetime('now')";
  await client.execute({
    sql: `UPDATE documents SET content = ?, updated_at = ${nowExpr} WHERE id = ?`,
    args: [content, id],
  });

  // Push edits through Yjs for live collaborative sync.
  // Uses the server's HTTP endpoint (not the module directly) because actions
  // run in a separate process — the in-memory EventEmitter won't reach
  // the server's poll system.
  const collabEnabled = await hasCollabState(id);
  if (collabEnabled) {
    const origin =
      process.env.ORIGIN || `http://localhost:${process.env.PORT || 8080}`;
    for (const edit of edits!) {
      await fetch(`${origin}/_agent-native/collab/${id}/search-replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          find: edit.find,
          replace: edit.replace,
          requestSource: "agent",
        }),
      }).catch(() => {
        // Server might not be running (CLI mode) — SQL update is sufficient
      });
    }
  }

  // Trigger UI refresh
  await writeAppState("refresh-signal", { ts: Date.now() });

  console.log(
    `Edited document ${id}: ${changeCount}/${edits!.length} edit(s) applied`,
  );
  for (const r of results) console.log(`  - ${r}`);
}
