import { z } from "zod";

import { notebookOperationInputSchema } from "./notebook-operations.js";
import { notebookVersionIdSchema } from "./notebook-snapshot-contract.js";

export const notebookOriginIdSchema = z.uuid();

export const notebookUndoRequestSchema = notebookOperationInputSchema.extend({
  workingVersionId: notebookVersionIdSchema,
  originId: notebookOriginIdSchema,
  direction: z.enum(["undo", "redo"]),
});

export type NotebookUndoRequest = z.infer<typeof notebookUndoRequestSchema>;
