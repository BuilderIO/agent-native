import { fail, type ActionRunContext } from "@agent-native/core/action";

import { notebookMessages } from "../../app/i18n/messages/notebook.js";
import type { NotebookCommand } from "../../shared/notebook-operations.js";
import type { NotebookUndoRequest } from "../../shared/notebook-undo.js";
import { wakeReactiveNotebookRun } from "../model/notebook-execution/service.js";
import { applyNotebookOperation } from "../model/notebook-operations/store.js";
import { requireCurrentWorkspace } from "./workspace-access.js";

export async function applyNotebookOperationAction(
  command: NotebookCommand | NotebookUndoRequest,
  context?: ActionRunContext,
) {
  const scope = await requireCurrentWorkspace();
  const receipt = await applyNotebookOperation(scope, command);
  if (receipt.status === "conflict") {
    const { notebook: copy } = notebookMessages;
    const cellChanged =
      receipt.reason === "cell_changed" || receipt.reason === "label_changed";
    fail(cellChanged ? copy.cellEditChanged : copy.saveFailed, {
      statusCode: 409,
      errorCode: "notebook_conflict",
      details: { receipt },
    });
  }
  if (
    receipt.status === "applied" &&
    (context?.requestHeaders || context?.runId) &&
    receipt.delta.cells.some(({ contents }) => contents.kind === "input")
  )
    wakeReactiveNotebookRun(
      { ...scope, caller: context.caller },
      command.projectId,
    );
  return receipt;
}
