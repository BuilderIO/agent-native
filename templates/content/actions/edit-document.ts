import { defineAction } from "@agent-native/core";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { writeAppState } from "@agent-native/core/application-state";
import { hasCollabState } from "@agent-native/core/collab";
import { getCurrentOwnerEmail } from "../server/lib/documents.js";
import { z } from "zod";

interface TextEdit {
  find: string;
  replace: string;
}

export default defineAction({
  description:
    "Surgically edit document content using search-and-replace. Preferred over update-document for modifications.",
  schema: z.object({
    id: z.string().optional().describe("Document ID (required)"),
    find: z.string().optional().describe("Text to find (single edit mode)"),
    replace: z
      .string()
      .optional()
      .describe('Replacement text (single edit mode, default: "")'),
    edits: z
      .string()
      .optional()
      .describe("JSON array of {find, replace} objects (batch mode)"),
  }),
  http: false,
  run: async (args) => {
    const id = args.id;
    if (!id) throw new Error("--id is required");

    // Parse edits from either --find/--replace or --edits JSON
    let edits: TextEdit[];

    if (args.edits) {
      try {
        edits = JSON.parse(args.edits);
        if (!Array.isArray(edits))
          throw new Error("--edits must be a JSON array");
      } catch (e: any) {
        throw new Error(`Invalid --edits JSON: ${e.message}`);
      }
    } else if (args.find !== undefined) {
      if (!args.find) throw new Error("--find cannot be empty");
      edits = [{ find: args.find, replace: args.replace ?? "" }];
    } else {
      throw new Error("Either --find or --edits is required");
    }

    // Validate edits
    for (const edit of edits) {
      if (!edit.find)
        throw new Error("Each edit must have a non-empty 'find' field");
      if (edit.replace === undefined) edit.replace = "";
    }

    const ownerEmail = getCurrentOwnerEmail();
    // Fetch current content
    const client = getDbExec();
    const existing = await client.execute({
      sql: "SELECT id, title, content FROM documents WHERE id = ? AND owner_email = ?",
      args: [id, ownerEmail],
    });
    if (!existing.rows || existing.rows.length === 0) {
      throw new Error(`Document "${id}" not found`);
    }

    let content = (existing.rows[0] as any).content ?? "";
    const results: string[] = [];
    let changeCount = 0;

    // Apply edits sequentially
    for (const edit of edits) {
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
      return { applied: 0, total: edits.length, results };
    }

    // Write updated content to SQL
    const nowExpr = isPostgres() ? "NOW()::text" : "datetime('now')";
    await client.execute({
      sql: `UPDATE documents SET content = ?, updated_at = ${nowExpr} WHERE id = ? AND owner_email = ?`,
      args: [content, id, ownerEmail],
    });

    // Push edits through Yjs for live collaborative sync.
    const collabEnabled = await hasCollabState(id);
    if (collabEnabled) {
      const tryOrigins = [
        process.env.ORIGIN,
        process.env.PORT ? `http://localhost:${process.env.PORT}` : null,
        "http://localhost:8080",
        "http://localhost:8081",
        "http://localhost:8082",
        "http://localhost:8083",
      ].filter(Boolean) as string[];

      let serverOrigin: string | null = null;
      for (const origin of tryOrigins) {
        try {
          const res = await fetch(`${origin}/_agent-native/ping`, {
            signal: AbortSignal.timeout(500),
          });
          if (res.ok) {
            serverOrigin = origin;
            break;
          }
        } catch {
          // Try next
        }
      }

      if (serverOrigin) {
        for (const edit of edits) {
          await fetch(
            `${serverOrigin}/_agent-native/collab/${id}/search-replace`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                find: edit.find,
                replace: edit.replace,
                requestSource: "agent",
              }),
            },
          ).catch(() => {});
        }
      }
    }

    // Trigger UI refresh
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Edited document ${id}: ${changeCount}/${edits.length} edit(s) applied`,
    );
    for (const r of results) console.log(`  - ${r}`);

    return { applied: changeCount, total: edits.length, results };
  },
});
