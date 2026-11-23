import { randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";

import { notebookMessages } from "../../../app/i18n/messages/notebook.js";
import type {
  NotebookSnapshot,
  OperationReceipt,
} from "../../../shared/notebook-operations.js";
import {
  CONTRACT_VERSION,
  notebookCellIdSchema,
} from "../../../shared/notebook-snapshot-contract.js";
import { assertEditableProject } from "../project-access.js";
import type { WorkspaceScope } from "../scope.js";
import type { NotebookWrite } from "./commands.js";
import { adoptNotebook } from "./migration.js";
import {
  applyNotebookOperation,
  notebookBusy,
  readNotebookDraft,
} from "./store.js";

export async function readLegacyNotebook(
  scope: WorkspaceScope,
  projectId: string,
) {
  await assertEditableProject(scope, projectId);
  const draft = await readNotebookDraft(scope, projectId);
  if (draft) return draft;
  await adoptNotebook(scope, projectId);
  return (await readNotebookDraft(scope, projectId)) ?? notebookBusy();
}

export type LegacyNotebook = Awaited<ReturnType<typeof readLegacyNotebook>>;

export function legacyGap(cells: readonly { id: string }[], position: number) {
  const clamped = Math.max(0, Math.min(position, cells.length));
  const after = cells[clamped - 1];
  const before = cells[clamped];
  return {
    afterCellId: after ? notebookCellIdSchema.parse(after.id) : null,
    beforeCellId: before ? notebookCellIdSchema.parse(before.id) : null,
  };
}

export function requireLegacyCell<T extends { id: string }>(
  draft: { cells: readonly T[] },
  cellId: string,
) {
  const cell = draft.cells.find(({ id }) => id === cellId);
  if (cell) return cell;
  return fail("That cell is not in this project.", {
    statusCode: 404,
    errorCode: "cell_not_found",
  });
}

export function applyLegacyNotebookOperation(
  scope: WorkspaceScope,
  state: NotebookSnapshot,
  changes: NotebookWrite[],
  suppressReactiveRun?: boolean,
  originId?: string,
) {
  const { projectId, head } = state.snapshot;
  return applyNotebookOperation(
    scope,
    {
      protocol: CONTRACT_VERSION,
      projectId,
      workingVersionId: head.versionId,
      observedHead: head,
      opId: randomUUID(),
      changes,
      ...(suppressReactiveRun ? { suppressReactiveRun } : {}),
      ...(originId === undefined ? {} : { originId }),
    },
    false,
  );
}

export function requireAppliedNotebookOperation(receipt: OperationReceipt) {
  if (receipt.status !== "conflict") return receipt;
  return fail(notebookMessages.notebook.saveFailed, {
    statusCode: 409,
    errorCode: "notebook_conflict",
    details: { receipt },
  });
}
