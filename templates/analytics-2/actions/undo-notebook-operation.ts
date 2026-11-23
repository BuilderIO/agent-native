import { defineAction } from "@agent-native/core/action";

import { applyNotebookOperationAction } from "../server/lib/notebook-operation-action.js";
import { notebookChangeResource } from "../server/lib/project-action-access.js";
import { operationReceiptSchema } from "../shared/notebook-operations.js";
import { notebookUndoRequestSchema } from "../shared/notebook-undo.js";

export default defineAction({
  description:
    "Undo or redo the latest eligible edit for this account, editing origin, and working notebook version. Reuse the same operation ID when the outcome is unknown.",
  schema: notebookUndoRequestSchema,
  outputSchema: operationReceiptSchema,
  outputErrorStrategy: "strict",
  changeResource: (command, receipt) =>
    receipt.status === "applied" ? notebookChangeResource(command) : null,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: applyNotebookOperationAction,
});
