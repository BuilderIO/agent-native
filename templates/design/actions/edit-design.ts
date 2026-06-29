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
import {
  applyOneEdit,
  type ApplyEditsResult,
  type DesignEdit,
} from "../shared/apply-edits.js";

const editBlocksSchema = z.preprocess(
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
);

function stripStableNodeIdAttributes(value: string): {
  content: string;
  indexMap: number[];
} {
  const stableIdPattern =
    /\sdata-agent-native-node-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s/>]+)/gi;
  let content = "";
  const indexMap: number[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = stableIdPattern.exec(value))) {
    const chunk = value.slice(cursor, match.index);
    for (let i = 0; i < chunk.length; i += 1) {
      content += chunk[i];
      indexMap.push(cursor + i);
    }
    cursor = match.index + match[0].length;
  }
  const tail = value.slice(cursor);
  for (let i = 0; i < tail.length; i += 1) {
    content += tail[i];
    indexMap.push(cursor + i);
  }
  indexMap.push(value.length);
  return { content, indexMap };
}

function findUniqueStableIdAgnosticSpan(
  content: string,
  search: string,
): { start: number; end: number } | null {
  const strippedContent = stripStableNodeIdAttributes(content);
  const strippedSearch = stripStableNodeIdAttributes(search).content;
  if (!strippedSearch) return null;

  let count = 0;
  let onlyIndex = -1;
  let index = strippedContent.content.indexOf(strippedSearch);
  while (index !== -1) {
    count += 1;
    onlyIndex = index;
    if (count > 1) return null;
    index = strippedContent.content.indexOf(strippedSearch, index + 1);
  }
  if (count !== 1) return null;

  return {
    start: strippedContent.indexMap[onlyIndex] ?? 0,
    end:
      strippedContent.indexMap[onlyIndex + strippedSearch.length] ??
      content.length,
  };
}

function applyOneEditWithStableIdFallback(
  content: string,
  edit: DesignEdit,
  index: number,
): string {
  try {
    return applyOneEdit(content, edit, index);
  } catch (error) {
    const span = findUniqueStableIdAgnosticSpan(content, edit.search);
    if (!span) throw error;
    return `${content.slice(0, span.start)}${edit.replace}${content.slice(span.end)}`;
  }
}

export function applySearchReplaceEdits(
  content: string,
  edits: DesignEdit[],
): ApplyEditsResult {
  let next = content;
  edits.forEach((edit, index) => {
    next = applyOneEditWithStableIdFallback(next, edit, index);
  });
  return { content: next, applied: edits.length };
}

export default defineAction({
  description:
    "Edit ONE file in a design after reading it with get-design-snapshot. " +
    "For small localized refinements, apply surgical search/replace edits — the " +
    "preferred way to refine an existing design without regenerating the whole " +
    "file (cheaper, faster, and it preserves everything you don't touch). Each " +
    "edit's `search` must match the current file exactly and uniquely, so " +
    "include enough surrounding context. Read the file first with " +
    "`get-design-snapshot`. Wrapping an element is just a search/replace whose " +
    "`replace` adds the wrapper around the original text. For broad copy-only " +
    'changes such as translating all visible text, use `mode: "replace-file"` ' +
    "with `replacementContent`: the complete updated file content copied from " +
    "the snapshot with only the requested copy changed. Use `generate-design` " +
    "instead only for brand-new files or large structural rewrites.",
  schema: z
    .object({
      designId: z.string().describe("Design project ID"),
      filename: z
        .string()
        .default("index.html")
        .describe("File to edit (e.g. 'index.html')"),
      mode: z
        .enum(["search-replace", "replace-file"])
        .optional()
        .describe(
          "Defaults to search-replace. Use replace-file for broad copy-only edits like translating the whole page after reading get-design-snapshot.",
        ),
      edits: editBlocksSchema
        .optional()
        .describe(
          "Search/replace blocks, applied in order. Use for small localized edits.",
        ),
      replacementContent: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Complete updated file content. Use only with mode=replace-file for broad copy-only changes; preserve all HTML structure, CSS, scripts, and tweaks from get-design-snapshot.",
        ),
    })
    .superRefine((value, ctx) => {
      const mode =
        value.mode ??
        (value.replacementContent !== undefined
          ? "replace-file"
          : "search-replace");

      if (value.edits && value.replacementContent !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Use either edits or replacementContent in one edit-design call, not both.",
          path: ["replacementContent"],
        });
      }

      if (mode === "search-replace" && !value.edits) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "search-replace mode requires at least one edit block in edits.",
          path: ["edits"],
        });
      }

      if (mode === "replace-file" && value.replacementContent === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "replace-file mode requires replacementContent with the complete updated file.",
          path: ["replacementContent"],
        });
      }
    }),
  run: async ({ designId, filename, edits, mode, replacementContent }) => {
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

    const resolvedMode =
      mode ??
      (replacementContent !== undefined ? "replace-file" : "search-replace");
    const { content: nextContent, applied } =
      resolvedMode === "replace-file"
        ? { content: replacementContent ?? "", applied: 0 }
        : applySearchReplaceEdits(base, edits ?? []);
    const changed = nextContent !== base;

    if (changed) {
      // Mark agent presence + selection so live viewers can see where the
      // agent is working before the update arrives via collab.
      agentEnterDocument(file.id);
      if (resolvedMode === "search-replace" && applied > 0) {
        const firstSearch = edits?.[0]?.search;
        agentUpdateSelection(file.id, {
          selection: firstSearch
            ? `[data-edit-target="${firstSearch.slice(0, 40)}"]`
            : null,
          editingFile: filename,
          designId,
        });
      } else {
        agentUpdateSelection(file.id, {
          selection: null,
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
      mode: resolvedMode,
      editsApplied: applied,
      changed,
      bytesBefore: base.length,
      bytesAfter: nextContent.length,
    };
  },
});
