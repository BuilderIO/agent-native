import { defineAction } from "@agent-native/core";
import {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
} from "@agent-native/core/collab";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  readLiveSourceFile,
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
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

  // Anchor `end` to one byte past the LAST matched stripped character rather than
  // the mapped index of the NEXT character. Mapping the next index can land before
  // a stripped node-id attribute that sits right after the match, so the splice
  // would cross it and corrupt the file (e.g. duplicate/mangled tags).
  const lastMatched = onlyIndex + strippedSearch.length - 1;
  return {
    start: strippedContent.indexMap[onlyIndex] ?? 0,
    end: (strippedContent.indexMap[lastMatched] ?? content.length - 1) + 1,
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
    "the snapshot with only the requested copy changed. After a variant pick " +
    "or any other selected-screen follow-up, pass the exact `fileId` from " +
    '`get-design-snapshot` and use `mode: "replace-file"` when replacing ' +
    "the representative placeholder with a complete but compact UI in the chosen " +
    "direction; prioritize the primary workflow and render secondary details " +
    "as visible controls, states, or affordances when needed. Use `generate-design` " +
    "instead only for brand-new files.",
  schema: z
    .object({
      designId: z.string().describe("Design project ID"),
      fileId: z
        .string()
        .optional()
        .describe(
          "Optional exact design file ID to edit. Use this after a variant pick or selected-screen snapshot; when provided, it wins over filename.",
        ),
      filename: z
        .string()
        .optional()
        .describe(
          "File to edit (e.g. 'index.html'). Defaults to index.html only when fileId is omitted.",
        ),
      mode: z
        .enum(["search-replace", "replace-file"])
        .optional()
        .describe(
          "Defaults to search-replace. Use replace-file for selected variant expansion or broad copy-only edits after reading get-design-snapshot.",
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
          "Complete updated file content. Use only with mode=replace-file for selected variant expansion or broad copy-only changes; preserve all HTML structure, CSS, scripts, and tweaks from get-design-snapshot. For selected variants, keep the replacement complete but compact instead of expanding secondary details into an oversized payload.",
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
  run: async ({
    designId,
    fileId,
    filename,
    edits,
    mode,
    replacementContent,
  }) => {
    await assertAccess("design", designId, "editor");

    const db = getDb();
    const requestedFileId = fileId?.trim();
    const targetFilename = requestedFileId
      ? undefined
      : filename?.trim() || "index.html";
    const targetCondition = requestedFileId
      ? eq(schema.designFiles.id, requestedFileId)
      : eq(schema.designFiles.filename, targetFilename!);

    // Resolve the target file (access-scoped) by design + fileId or filename.
    const [file] = await db
      .select({
        id: schema.designFiles.id,
        designId: schema.designFiles.designId,
        filename: schema.designFiles.filename,
        fileType: schema.designFiles.fileType,
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
          targetCondition,
          accessFilter(schema.designs, schema.designShares),
        ),
      )
      .limit(1);

    if (!file) {
      throw new Error(
        requestedFileId
          ? `File id "${requestedFileId}" not found in design ${designId}`
          : `File "${targetFilename}" not found in design ${designId}`,
      );
    }

    // Read the LIVE base (collab text when present, else the SQL row) right
    // before transforming, and carry its versionHash through to the write
    // below. writeInlineSourceFile re-reads the live text immediately before
    // its own applyText/DB write and rejects if it no longer matches this
    // hash — closing the race window where a concurrent editor/agent write
    // lands between this read and the persist (the same stale-diff-base bug
    // fixed for insert-design-native-asset.ts and insert-asset.ts: a diff
    // computed from a stale base, char-diffed into a collab doc that has
    // since moved on, corrupts or drops the other writer's change).
    const workspaceFile: SourceWorkspaceFile = {
      id: file.id,
      designId: file.designId,
      filename: file.filename ?? "",
      fileType: file.fileType ?? "html",
      content: file.content,
      createdAt: null,
      updatedAt: null,
    };
    const live = await readLiveSourceFile(workspaceFile);
    const base = live.content;

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
      //
      // No resolvable DOM selector is available here (search-replace targets
      // source text, not a stamped node), so we publish `selection: null`
      // rather than a fabricated `[data-edit-target=...]` selector that could
      // never resolve against the rendered iframe. Region attribution instead
      // rides on the `{ kind: "text", quote }` recentEdits descriptor that
      // `applyText(..., "agent")` auto-publishes from the content diff inside
      // writeInlineSourceFile below — clients render a lingering highlight
      // over the changed text.
      agentEnterDocument(file.id);
      agentUpdateSelection(file.id, {
        selection: null,
        editingFile: file.filename,
        designId,
      });

      try {
        await writeInlineSourceFile({
          designId: file.designId,
          file: workspaceFile,
          content: nextContent,
          expectedVersionHash: live.versionHash,
        });
      } finally {
        agentLeaveDocument(file.id);
      }
    }

    return {
      designId,
      filename: file.filename,
      fileId: file.id,
      mode: resolvedMode,
      editsApplied: applied,
      changed,
      bytesBefore: base.length,
      bytesAfter: nextContent.length,
    };
  },
});
