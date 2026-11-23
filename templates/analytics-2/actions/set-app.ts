import { defineAction, defineActionErrors } from "@agent-native/core/action";

import { applyNotebookOperationAction } from "../server/lib/notebook-operation-action.js";
import { isNotebookToolWrite } from "../server/lib/notebook-tool-context.js";
import { invalidNotebookProposal } from "../server/lib/notebook-tool-proposal.js";
import { notebookChangeResource } from "../server/lib/project-action-access.js";
import {
  agentSetAppCommandSchema,
  operationReceiptSchema,
  setAppCommandSchema,
} from "../shared/notebook-operations.js";

export default defineAction({
  description:
    "Edit an app layout atomically. Read the draft head, order revision and app layout with get-project first. Reuse the operation ID when retrying the same edit.",
  schema: setAppCommandSchema,
  agentInputSchema: agentSetAppCommandSchema,
  outputSchema: operationReceiptSchema,
  outputErrorStrategy: "strict",
  changeResource: (command, receipt) =>
    receipt.status === "applied" ? notebookChangeResource(command) : null,
  retrySafe: true,
  errors: defineActionErrors(
    "app_layout_invalid",
    "notebook_conflict",
    "operation_id_reused",
    "notebook_invalid_change",
    "notebook_busy",
    "project_not_found",
    "invalid_proposal",
  ),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: (command, context) => {
    if (
      isNotebookToolWrite(context) &&
      command.changes[0].patches.some(
        (patch) => patch.type === "insert-and-place",
      )
    )
      invalidNotebookProposal();
    return applyNotebookOperationAction(command, context);
  },
});
