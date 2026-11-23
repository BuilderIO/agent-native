import { defineAction } from "@agent-native/core/action";

import { applyNotebookOperationAction } from "../server/lib/notebook-operation-action.js";
import { notebookChangeResource } from "../server/lib/project-action-access.js";
import {
  notebookCommandSchema,
  operationReceiptSchema,
} from "../shared/notebook-operations.js";

export default defineAction({
  description: "Apply a conditional notebook draft edit.",
  schema: notebookCommandSchema,
  outputSchema: operationReceiptSchema,
  outputErrorStrategy: "strict",
  uiOnly: true,
  changeResource: (command, receipt) =>
    receipt.status === "applied" ? notebookChangeResource(command) : null,
  run: applyNotebookOperationAction,
});
