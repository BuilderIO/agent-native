import { z } from "zod";

import { runReceiptSchema } from "./notebook-execution.js";
import {
  appliedReceiptSchema,
  draftHeadSchema,
  notebookTableRunSchema,
  revisionSchema,
} from "./notebook-operations.js";
import {
  notebookCellIdSchema,
  notebookProjectIdSchema,
  notebookVersionIdSchema,
} from "./notebook-snapshot-contract.js";
import { warehouseTableRefSchema } from "./warehouse-table.js";

export const queryNotebookTableInputSchema = z.strictObject({
  projectId: notebookProjectIdSchema,
  workingVersionId: notebookVersionIdSchema,
  observedHead: draftHeadSchema,
  requestId: z.uuid(),
  originId: z.uuid().optional(),
  cellId: notebookCellIdSchema,
  table: warehouseTableRefSchema,
  afterCellId: notebookCellIdSchema.nullable(),
  expectedOrderRevision: revisionSchema,
  throughOperationIds: z.array(z.uuid()).max(100).default([]),
});

export const queryNotebookTableReceiptSchema = notebookTableRunSchema.extend({
  insert: appliedReceiptSchema,
  run: runReceiptSchema,
});

export type QueryNotebookTableInput = z.infer<
  typeof queryNotebookTableInputSchema
>;

export type QueryNotebookTableReceipt = z.infer<
  typeof queryNotebookTableReceiptSchema
>;
