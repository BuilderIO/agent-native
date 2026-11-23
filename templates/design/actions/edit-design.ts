import {
  ActionContractError,
  defineAction,
  NoWriteError,
} from "@agent-native/core/action";
import {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
} from "@agent-native/core/collab";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { trackDesign } from "../server/lib/design-tracking.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  readLiveSourceFile,
  SourceWorkspaceEditConflictError,
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import {
  ApplyEditConflictError,
  applyEditsInOrder,
  applyOneEdit,
  findWhitespaceFlexibleMatches,
  type ApplyEditsResult,
  type DesignEdit,
} from "../shared/apply-edits.js";
import { promoteAuthoredSvgArtworkInHtml } from "../shared/authored-svg-layers.js";
import { designOutputWriteReceipt } from "../shared/generation-output-receipt.js";
import {
  assertLockedLayersPreserved,
  LockedLayerEditError,
} from "../shared/locked-layers.js";

const editBlocksSchema = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v;
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
  editIndex: number,
): { start: number; end: number } | null {
  const strippedContent = stripStableNodeIdAttributes(content);
  const searchProjection = stripStableNodeIdAttributes(search);
  const strippedSearch = searchProjection.content;
  if (!strippedSearch) return null;

  const firstExact = strippedContent.content.indexOf(strippedSearch);
  if (firstExact === -1) return null;
  if (strippedContent.content.indexOf(strippedSearch, firstExact + 1) !== -1) {
    throw new ApplyEditConflictError(
      `Edit ${editIndex + 1}: "search" matched multiple places (exact) — add more surrounding context so it matches exactly one location.`,
      "ambiguous",
    );
  }
  const matches = findWhitespaceFlexibleMatches(
    strippedContent.content,
    strippedSearch,
  );
  if (matches.length > 1) {
    throw new ApplyEditConflictError(
      `Edit ${editIndex + 1}: "search" matched ${matches.length} places (whitespace-insensitive) — add more surrounding context so it matches exactly one location.`,
      "ambiguous",
    );
  }
  const start = firstExact;
  const end = start + strippedSearch.length;
  const originalStart = strippedContent.indexMap[start] ?? 0;
  const originalEnd =
    (strippedContent.indexMap[end - 1] ?? content.length - 1) + 1;
  const previousEnd =
    start === 0 ? 0 : (strippedContent.indexMap[start - 1] ?? -1) + 1;
  const nextStart = strippedContent.indexMap[end] ?? content.length;
  if (
    originalStart !== previousEnd ||
    originalEnd !== nextStart ||
    searchProjection.indexMap[0] !== 0 ||
    searchProjection.indexMap[strippedSearch.length - 1] !== search.length - 1
  ) {
    throw new ApplyEditConflictError(
      `Edit ${editIndex + 1}: "search" matched at a stable-ID boundary that could belong to several places. Read the current file (get-design-snapshot) and include the complete element in the search.`,
      "ambiguous",
    );
  }
  return { start: originalStart, end: originalEnd };
}

function applyOneEditWithStableIdFallback(
  content: string,
  edit: DesignEdit,
  index: number,
): string {
  try {
    return applyOneEdit(content, edit, index);
  } catch (error) {
    if (!(error instanceof ApplyEditConflictError)) throw error;
    if (error.kind === "not_found") {
      const span = findUniqueStableIdAgnosticSpan(content, edit.search, index);
      if (span) {
        return `${content.slice(0, span.start)}${edit.replace}${content.slice(span.end)}`;
      }
    }
    throw error;
  }
}

function designEditConflictOptions() {
  return { errorCode: "design_edit_conflict", statusCode: 409 } as const;
}

export function applySearchReplaceEdits(
  content: string,
  edits: DesignEdit[],
): ApplyEditsResult {
  try {
    return applyEditsInOrder(content, edits, applyOneEditWithStableIdFallback);
  } catch (error) {
    if (!(error instanceof ApplyEditConflictError)) throw error;
    throw new NoWriteError(
      `${error.message} None of the edits in this batch were saved to the file. Re-read the current file with get-design-snapshot, then retry all intended edits in the rejected batch with enough context to uniquely identify each match. Use one pass or smaller sequential batches when appropriate.`,
      designEditConflictOptions(),
    );
  }
}

export function preCheckpointNoWriteError(error: unknown): NoWriteError {
  if (error instanceof NoWriteError) return error;
  return new NoWriteError(
    error instanceof Error ? error.message : String(error),
    error instanceof ActionContractError
      ? { errorCode: error.errorCode, statusCode: error.statusCode }
      : undefined,
  );
}

export default defineAction({
  description:
    "Edit ONE file in a design after reading it with get-design-snapshot. " +
    "To move an element to another screen use move-design-element, not two " +
    "edits here. " +
    '`mode` defaults to "search-replace" (apply edit blocks); use ' +
    '`mode: "replace-file"` with `replacementContent` only for the ' +
    "broad-replacement cases below. For small localized refinements, apply " +
    "surgical search/replace edits — the " +
    "preferred way to refine an existing design without regenerating the whole " +
    "file (cheaper, faster, and it preserves everything you don't touch). Each " +
    "edit's `search` must match the current file exactly and uniquely, so " +
    "include enough surrounding context. Read the file first with " +
    "`get-design-snapshot`. Prefer restyling an existing parent over adding a " +
    "wrapper; add one only when no existing element can hold the layout. Keep " +
    "every px length a whole number. For broad copy-only " +
    'changes such as translating all visible text, use `mode: "replace-file"` ' +
    "with `replacementContent`: the complete updated file content copied from " +
    "the snapshot with only the requested copy changed. After a variant pick " +
    "or any other selected-screen follow-up, pass the exact `fileId` from " +
    '`get-design-snapshot` and use `mode: "replace-file"` when replacing ' +
    "the representative placeholder with a complete but compact UI in the chosen " +
    "direction; prioritize the primary workflow and render secondary details " +
    "as visible controls, states, or affordances when needed. For a style change " +
    "(colors, fonts, spacing, dark mode), call `index-design-tokens` first and reuse " +
    "the design's existing tokens so the edited screen matches its siblings; " +
    "introduce values the design does not already use only when asked. " +
    "When refining email HTML, preserve email-safe tables, inline-compatible styles, required HubL footer tokens and any existing internal marker; validate its handoff with export-hubspot-html, which accepts any HTML frame. To rebuild an ordinary frame as a HubSpot email, read it first and use create-file for a new sibling rather than overwriting the source. Use `generate-design` instead only for brand-new files.",
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
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  // replace-file writes a fixed end state; search-replace can re-match its own
  // replacement text, so a replay after a lost result may apply an edit twice.
  retrySafe: (input) =>
    (input.mode ??
      (input.replacementContent !== undefined
        ? "replace-file"
        : "search-replace")) === "replace-file",
  run: async (
    { designId, fileId, filename, edits, mode, replacementContent },
    context,
  ) => {
    await assertAccess("design", designId, "editor");
    const db = getDb();
    const requestedFileId = fileId?.trim();
    const targetFilename = requestedFileId
      ? undefined
      : filename?.trim() || "index.html";
    const targetCondition = requestedFileId
      ? eq(schema.designFiles.id, requestedFileId)
      : eq(schema.designFiles.filename, targetFilename!);

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
      throw new NoWriteError(
        requestedFileId
          ? `File id "${requestedFileId}" not found in design ${designId}`
          : `File "${targetFilename}" not found in design ${designId}`,
        { errorCode: "design_file_not_found", statusCode: 404 },
      );
    }

    const resolvedMode =
      mode ??
      (replacementContent !== undefined ? "replace-file" : "search-replace");

    const MAX_EDIT_CONFLICT_RETRIES = 2;

    let live: Awaited<ReturnType<typeof readLiveSourceFile>>;
    let base = "";
    let nextContent = "";
    let applied = 0;
    let changed = false;
    let checkpointed = false;

    for (let attempt = 0; ; attempt += 1) {
      const currentContent =
        attempt === 0
          ? file.content
          : (
              await db
                .select({ content: schema.designFiles.content })
                .from(schema.designFiles)
                .where(eq(schema.designFiles.id, file.id))
                .limit(1)
            )[0]?.content;

      const workspaceFile: SourceWorkspaceFile = {
        id: file.id,
        designId: file.designId,
        filename: file.filename ?? "",
        fileType: file.fileType ?? "html",
        content: currentContent,
        createdAt: null,
        updatedAt: null,
      };
      live = await readLiveSourceFile(workspaceFile);
      base = live.content;

      if (resolvedMode === "replace-file") {
        ({ content: nextContent, applied } = {
          content: replacementContent ?? "",
          applied: 0,
        });
      } else {
        try {
          ({ content: nextContent, applied } = applySearchReplaceEdits(
            base,
            edits ?? [],
          ));
        } catch (error) {
          if (!checkpointed) {
            throw preCheckpointNoWriteError(error);
          }
          if (error instanceof NoWriteError) {
            throw new ActionContractError(error.message, {
              errorCode: error.errorCode,
              statusCode: error.statusCode,
            });
          }
          throw error;
        }
      }
      if (file.fileType === "html") {
        nextContent = promoteAuthoredSvgArtworkInHtml(nextContent, {
          previousHtml: base,
        }).content;
      }
      changed = nextContent !== base;

      if (!changed) break;

      try {
        assertLockedLayersPreserved(base, nextContent);
      } catch (error) {
        if (error instanceof LockedLayerEditError) {
          if (checkpointed) throw error;
          throw new NoWriteError(error.message, {
            errorCode: error.errorCode,
            statusCode: error.statusCode,
          });
        }
        throw error;
      }

      if (!checkpointed) {
        await snapshotDesignBeforeAgentEdit(designId, context);
        checkpointed = true;
      }

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
      } catch (error) {
        if (
          error instanceof SourceWorkspaceEditConflictError &&
          resolvedMode === "search-replace" &&
          attempt < MAX_EDIT_CONFLICT_RETRIES
        ) {
          continue;
        }
        throw error;
      } finally {
        agentLeaveDocument(file.id);
      }
      break;
    }

    trackDesign(
      "design_edited",
      {
        output_id: designId,
        output_type: "design",
        edit_type: resolvedMode,
        edits_count: applied,
      },
      context,
    );

    return {
      designId,
      filename: file.filename,
      fileId: file.id,
      mode: resolvedMode,
      editsApplied: applied,
      changed,
      _receipt: designOutputWriteReceipt(designId, changed ? 1 : 0),
      bytesBefore: base.length,
      bytesAfter: nextContent.length,
    };
  },
});
