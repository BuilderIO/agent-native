import { ActionContractError } from "@agent-native/core";
import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { agentTouchDocument } from "@agent-native/core/collab";
import { assertAccess } from "@agent-native/core/sharing";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { findDocumentBodyBase } from "../server/lib/document-body-intents.js";
import { rebuildDocumentBodyBase } from "../server/lib/document-body-steps.js";
import { documentChangeResource } from "../server/lib/document-change-resource.js";
import {
  documentContentHash,
  documentRevisionToken,
  parseDocumentRevisionToken,
} from "../server/lib/document-revision.js";
import {
  editNfmTable,
  TABLE_COLORS,
  TableEditError,
} from "../shared/table-edits.js";
import { recordContentSaveOutcome } from "./_content-save-outcomes.js";
import { mutateDocumentBody } from "./_document-edit-mutation.js";
import {
  assertLocalFolderAllowsPageEdit,
  assertSourceAllowsPageEdit,
} from "./_document-source.js";

const number = z.number().int().min(1);
const row = number.describe("Row number, from 1 at the top");
const column = number.describe("Column number, from 1 at the left");
const cells = z
  .array(z.string())
  .describe(
    "Optional inline NFM for the new cells, in order; fewer than the table needs leaves the rest empty",
  );
const cellText = z
  .string()
  .describe(
    "The cell's inline NFM on one line: **bold**, *italic*, `code`, [links](url); <br> for a line break",
  );

const operationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("insert-row"),
    at: number
      .optional()
      .describe("The new row's number; omit to add it at the bottom"),
    cells: cells.optional(),
  }),
  z.object({ op: z.literal("delete-row"), row }),
  z.object({
    op: z.literal("move-row"),
    row,
    to: number.describe("The row's number after the move"),
  }),
  z.object({
    op: z.literal("duplicate-row"),
    row: row.describe("Row to copy; the copy goes below it"),
  }),
  z.object({
    op: z.literal("clear-row"),
    row: row.describe("Row whose cells to empty; colours stay"),
  }),
  z.object({
    op: z.literal("insert-column"),
    at: number
      .optional()
      .describe("The new column's number; omit to add it at the right"),
    cells: cells.optional(),
  }),
  z.object({ op: z.literal("delete-column"), column }),
  z.object({
    op: z.literal("move-column"),
    column,
    to: number.describe("The column's number after the move"),
  }),
  z.object({
    op: z.literal("duplicate-column"),
    column: column.describe("Column to copy; the copy goes to its right"),
  }),
  z.object({
    op: z.literal("clear-column"),
    column: column.describe("Column whose cells to empty; colours stay"),
  }),
  z.object({ op: z.literal("set-cell"), row, column, text: cellText }),
  z.object({
    op: z.literal("set-header-row"),
    value: z.boolean().describe("Whether row 1 is a header row"),
  }),
  z.object({
    op: z.literal("set-header-column"),
    value: z.boolean().describe("Whether column 1 is a header column"),
  }),
  z.object({
    op: z.literal("set-fit-page-width"),
    value: z
      .boolean()
      .describe("Whether the table stretches to the page's width"),
  }),
  z.object({
    op: z.literal("set-color"),
    row: row.optional(),
    column: column.optional(),
    color: z
      .enum(TABLE_COLORS)
      .nullable()
      .describe(
        "A text colour, or one ending in _bg for a background; null clears it",
      ),
  }),
]);

const operationsSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    fail(
      `Invalid --operations JSON: ${error instanceof Error ? error.message : "Unable to parse JSON"}`,
      { errorCode: "INVALID_OPERATIONS_JSON", statusCode: 400 },
    );
  }
}, z.array(operationSchema).min(1).max(500));

const editTableSchema = z.object({
  id: z.string().min(1).describe("Stable ID of the page holding the table."),
  baseRevision: z
    .string()
    .min(1)
    .describe(
      "Opaque revision of the exact body being edited, from get-document, create-document or the previous edit's receipt.revisions.after.",
    ),
  idempotencyKey: z
    .string()
    .min(1)
    .max(200)
    .describe("Caller-generated stable key for this one table edit."),
  table: number.describe(
    "Which table on the page, counting from 1 in page order: each <table> block and each Markdown pipe table in the get-document body counts, including tables inside toggles, callouts and columns.",
  ),
  operations: operationsSchema.describe(
    "The changes, applied in order; each sees the table the ones before it left, so later row and column numbers count after earlier inserts, deletes and moves.",
  ),
});

const editTableResultSchema = z.object({
  applied: z.number(),
  total: z.number(),
  preservationRequired: z
    .object({
      reason: z.enum(["structure", "provenance"]),
      checkpointId: z.string(),
    })
    .optional(),
  receipt: z.object({
    receiptId: z.string(),
    outcome: z.enum([
      "applied",
      "unchanged",
      "displaced-preserved",
      "preservation-required",
    ]),
    displacedCheckpointId: z.string().optional(),
    documentId: z.string(),
    revisions: z.object({ before: z.string(), after: z.string() }),
    bodyRevision: z.object({ before: z.number(), after: z.number() }),
    hashes: z.object({ before: z.string(), after: z.string() }),
    ranges: z.array(
      z.object({ editIndex: z.number(), start: z.number(), end: z.number() }),
    ),
    idempotency: z.object({
      key: z.string(),
      result: z.enum(["applied", "replayed"]),
      payloadDigest: z.string(),
    }),
    readback: z.object({ verified: z.literal(true) }),
  }),
  table: z
    .object({
      table: z.number(),
      rows: z.number(),
      columns: z.number(),
      headerRow: z.boolean(),
      headerColumn: z.boolean(),
      fitPageWidth: z.boolean(),
    })
    .nullable(),
});

async function readEditBase(
  document: {
    id: string;
    ownerEmail: string;
    content: string | null;
    bodyRevision: number;
  },
  baseRevision: string,
): Promise<string> {
  const base = parseDocumentRevisionToken(baseRevision);
  if (base === null) {
    throw new ActionContractError(
      "baseRevision is not a valid document revision token.",
      { errorCode: "INVALID_BASE_REVISION", statusCode: 400 },
    );
  }
  const current = document.content ?? "";
  if (
    document.bodyRevision === base.revision &&
    documentContentHash(current) === base.contentHash
  ) {
    return current;
  }
  const db = getDb();
  const lookup = {
    db,
    ownerEmail: document.ownerEmail,
    documentId: document.id,
    contentHash: base.contentHash,
    revision: base.revision,
  };
  const found =
    (await findDocumentBodyBase(lookup)) ??
    (await rebuildDocumentBodyBase({
      ...lookup,
      current: { revision: document.bodyRevision, content: current },
    }));
  if (found !== null) return found;
  return staleBase(
    baseRevision,
    documentRevisionToken(document.bodyRevision, current),
    "The exact edit base is unavailable.",
  );
}

function staleBase(
  baseRevision: string,
  currentRevision: string,
  message: string,
): never {
  recordContentSaveOutcome("edit_document", {
    outcome: "refusal",
    origin: "agent",
    stale_base: "true",
    history_effect: "none",
    reason_code: "STALE_BASE_REVISION",
  });
  throw new ActionContractError(message, {
    errorCode: "STALE_BASE_REVISION",
    statusCode: 409,
    details: {
      expectedRevision: baseRevision,
      currentRevision,
    },
  });
}

export default defineAction({
  description:
    "Change one table on a page without rewriting the page: insert, delete, move, duplicate or clear rows and columns, set a cell's text, turn the header row or header column on or off, fit the table to the page width, and colour rows, columns or cells. Read the page with get-document first, then pass its baseRevision, a caller-generated idempotencyKey, the table's number and the operations. An applied receipt needs no readback.",
  searchHints: [
    "table row",
    "table column",
    "table cell",
    "header row",
    "header column",
    "add a row",
    "add a column",
    "reorder table rows",
    "fit table to page width",
    "colour a table row",
  ],
  mcpTool: true,
  schema: editTableSchema,
  outputSchema: editTableResultSchema,
  http: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  changeResource: (input) => documentChangeResource(input.id),
  run: async (args, ctx) => {
    if (!ctx) {
      throw new ActionContractError(
        "Revisioned document edits require an authenticated caller context.",
        { errorCode: "CALLER_SCOPE_REQUIRED", statusCode: 401 },
      );
    }
    const access = await assertAccess("document", args.id, "editor");
    const existing = access.resource;
    assertSourceAllowsPageEdit(existing);
    await assertLocalFolderAllowsPageEdit(existing);
    if (
      existing.sourceMode === "local-files" &&
      existing.sourceKind !== "folder" &&
      Boolean(existing.sourcePath) &&
      !args.id.startsWith("local-file:") &&
      !args.id.startsWith("local-folder:")
    ) {
      throw new ActionContractError(
        "Revisioned external edits are unavailable for linked-local documents because the source-file write cannot share the SQL receipt transaction.",
        {
          errorCode: "LINKED_LOCAL_REVISION_PROTOCOL_UNAVAILABLE",
          statusCode: 409,
        },
      );
    }

    const base = await readEditBase(existing, args.baseRevision);
    let edited: ReturnType<typeof editNfmTable>;
    try {
      edited = editNfmTable(base, args.table, args.operations);
    } catch (error) {
      if (!(error instanceof TableEditError)) throw error;
      throw new ActionContractError(error.message, {
        errorCode: error.code,
        statusCode: error.code === "TABLE_NOT_FOUND" ? 404 : 422,
        details: error.details,
      });
    }

    const result = await mutateDocumentBody({
      documentId: args.id,
      baseRevision: args.baseRevision,
      idempotencyKey: args.idempotencyKey,
      edits: [edited.edit],
      ctx,
      currentBaseOnly: true,
    });
    if (
      result.receipt.outcome === "unchanged" &&
      result.receipt.hashes.after !== documentContentHash(edited.markdown)
    ) {
      staleBase(
        args.baseRevision,
        result.receipt.revisions.after,
        "The page changed after this revision; read it again before editing.",
      );
    }
    await writeAppState("refresh-signal", { ts: Date.now() });
    const isAgentCaller =
      ctx.caller === "tool" || ctx.caller === "mcp" || ctx.caller === "a2a";
    if (isAgentCaller) {
      try {
        agentTouchDocument(args.id, {
          edit: {
            descriptor: { kind: "text", quote: "" },
            label: existing.title || undefined,
          },
        });
      } catch (error) {
        console.error("edit-table: agent presence publish failed", error);
      }
      if (result.applied > 0) {
        track(
          "ai_refine_used",
          {
            app_name: "content",
            template_name: "content",
            output_id: args.id,
            output_type: "document",
            edit_count: args.operations.length,
            refine_type: "table_edit",
          },
          ctx,
        );
      }
    }
    const saved =
      result.receipt.outcome === "applied" ||
      result.receipt.outcome === "unchanged";
    return { ...result, table: saved ? edited.summary : null };
  },
});
