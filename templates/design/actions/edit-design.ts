import { defineAction } from "@agent-native/core";
import {
  hasCollabState,
  getText,
  applyText,
  seedFromText,
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
} from "@agent-native/core/collab";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { applyEdits } from "../shared/apply-edits.js";

export default defineAction({
  description:
    "Apply small, surgical search/replace edits to ONE file in a design — the " +
    "preferred way to refine an existing design without regenerating the whole " +
    "file (cheaper, faster, and it preserves everything you don't touch). Each " +
    "edit's `search` must match the current file exactly and uniquely, so " +
    "include enough surrounding context. Read the file first with " +
    "`get-design-snapshot`. Wrapping an element is just a search/replace whose " +
    "`replace` adds the wrapper around the original text. Use `generate-design` " +
    "instead only for brand-new files or large structural rewrites.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    filename: z
      .string()
      .default("index.html")
      .describe("File to edit (e.g. 'index.html')"),
    edits: z
      .preprocess(
        (v) => {
          if (typeof v !== "string") return v;
          // Don't let malformed JSON throw an uncaught SyntaxError — return the
          // raw value so Zod produces a clean validation error instead.
          try {
            return JSON.parse(v);
          } catch {
            return v;
          }
        },
        z
          .array(
            z.object({
              search: z
                .string()
                .min(1)
                .describe(
                  "Exact text to find, with enough surrounding context to be unique",
                ),
              replace: z.string().describe("Replacement text"),
            }),
          )
          .min(1),
      )
      .describe("Search/replace blocks, applied in order"),
  }),
  run: async ({ designId, filename, edits }) => {
    await assertAccess("design", designId, "editor");

    const db = getDb();
    const now = new Date().toISOString();

    // Resolve the target file (access-scoped) by design + filename.
    const [file] = await db
      .select({
        id: schema.designFiles.id,
        content: schema.designFiles.content,
      })
      .from(schema.designFiles)
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(
        and(
          eq(schema.designFiles.designId, designId),
          eq(schema.designFiles.filename, filename),
          accessFilter(schema.designs, schema.designShares),
        ),
      )
      .limit(1);

    if (!file) {
      throw new Error(`File "${filename}" not found in design ${designId}`);
    }

    // Prefer live collab content so we edit in-flight changes, not a stale
    // persisted copy (mirrors get-design-snapshot).
    let base = file.content ?? "";
    try {
      if (await hasCollabState(file.id)) {
        // When a collab session exists it is authoritative — use its text even
        // if empty (a legitimately cleared file), rather than silently editing
        // stale stored HTML.
        const live = await getText(file.id, "content");
        if (typeof live === "string") base = live;
      }
    } catch {
      // Collab read is best-effort; fall back to stored content.
    }

    const { content: nextContent, applied } = applyEdits(base, edits);
    const changed = nextContent !== base;

    if (changed) {
      // Mark agent presence + selection so live viewers can see where the
      // agent is working before the update arrives via collab.
      agentEnterDocument(file.id);
      if (applied > 0) {
        agentUpdateSelection(file.id, {
          selection: edits[0]?.search
            ? `[data-edit-target="${edits[0].search.slice(0, 40)}"]`
            : null,
          editingFile: filename,
          designId,
        });
      }

      try {
        await db
          .update(schema.designFiles)
          .set({ content: nextContent, updatedAt: now })
          .where(eq(schema.designFiles.id, file.id));

        // Push the full new content through the collab layer; it diffs internally
        // so live editors get a minimal update.
        if (await hasCollabState(file.id)) {
          await applyText(file.id, nextContent, "content", "agent");
        } else {
          await seedFromText(file.id, nextContent);
        }

        await db
          .update(schema.designs)
          .set({ updatedAt: now })
          .where(eq(schema.designs.id, designId));
      } finally {
        agentLeaveDocument(file.id);
      }
    }

    return {
      designId,
      filename,
      fileId: file.id,
      editsApplied: applied,
      changed,
      bytesBefore: base.length,
      bytesAfter: nextContent.length,
    };
  },
});
