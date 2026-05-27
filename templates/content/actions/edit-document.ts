import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import {
  hasCollabState,
  agentEnterDocument,
  agentLeaveDocument,
} from "@agent-native/core/collab";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

interface TextEdit {
  find: string;
  replace: string;
}

async function findCollabOrigin(): Promise<string | null> {
  const tryOrigins = [
    process.env.ORIGIN,
    process.env.PORT ? `http://localhost:${process.env.PORT}` : null,
    "http://localhost:8080",
    "http://localhost:8081",
    "http://localhost:8082",
    "http://localhost:8083",
  ].filter(Boolean) as string[];
  for (const origin of tryOrigins) {
    try {
      const res = await fetch(`${origin}/_agent-native/ping`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) return origin;
    } catch {
      // Try next
    }
  }
  return null;
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

    const access = await assertAccess("document", id, "editor");
    const existing = access.resource;

    let content: string = existing.content ?? "";
    const results: string[] = [];
    let changeCount = 0;
    let yjsAcceptedCount = 0;

    // ─── Apply each edit through Yjs FIRST, then mirror locally ─────────────
    //
    // While the editor session is active TipTap renders the Y.XmlFragment,
    // not the documents.content row. The previous order (SQL first, Yjs
    // pushes after) raced the editor's autosave: the agent's SQL write would
    // be overwritten by the editor before the Yjs push landed, making the
    // agent's edit appear to revert. Pushing to Yjs first lets the change
    // merge with concurrent typing via CRDT, and any subsequent autosave
    // preserves the merged result.
    const collabActive = await hasCollabState(id);
    let serverOrigin: string | null = null;
    if (collabActive) {
      agentEnterDocument(id);
      serverOrigin = await findCollabOrigin();
    }

    try {
      for (const edit of edits) {
        // Step 1: push through Yjs
        if (collabActive && serverOrigin) {
          const res = await fetch(
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
          ).catch(() => null);
          if (res?.ok) {
            const json = (await res.json().catch(() => null)) as {
              found?: boolean;
            } | null;
            if (json?.found) yjsAcceptedCount++;
          }
        }

        // Step 2: mirror the edit on the local string for SQL persistence
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

        // Small delay between Yjs pushes for an incremental typing effect
        if (edits.length > 1 && collabActive && serverOrigin) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
    } finally {
      if (collabActive) agentLeaveDocument(id);
    }

    // Nothing matched in either Yjs or SQL — surface the not-found results
    // and skip persistence.
    if (changeCount === 0 && yjsAcceptedCount === 0) {
      console.log(
        "No edits applied — none of the find texts were found in the document.",
      );
      for (const r of results) console.log(`  - ${r}`);
      return { applied: 0, total: edits.length, results };
    }

    // ─── Persist to SQL ─────────────────────────────────────────────────────
    //
    // Always write when the local mirror produced a change so documents.content
    // stays current for closed-editor reads and for new clients that load the
    // doc before they fetch the Yjs state. Concurrent editor autosaves will
    // overwrite this with the merged Y.Doc state, which already contains the
    // agent's edits.
    if (changeCount > 0) {
      const db = getDb();
      await db
        .update(schema.documents)
        .set({ content, updatedAt: new Date().toISOString() })
        .where(eq(schema.documents.id, id));
    }

    // Trigger UI refresh
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(
      `Edited document ${id}: sql=${changeCount}/${edits.length} yjs=${yjsAcceptedCount}/${edits.length}`,
    );
    for (const r of results) console.log(`  - ${r}`);

    return {
      applied: changeCount,
      total: edits.length,
      results,
      collabSynced: yjsAcceptedCount > 0,
    };
  },
});
