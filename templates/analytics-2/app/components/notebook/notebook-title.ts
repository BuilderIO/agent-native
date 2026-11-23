import { callAction } from "@agent-native/core/client/hooks";

import {
  notebookOperationReadSchema,
  operationReceiptSchema,
  type NotebookCommand,
  type NotebookSnapshot,
} from "../../../shared/notebook-operations";
import { CONTRACT_VERSION } from "../../../shared/notebook-snapshot-contract";
import { notebookSnapshotActionReadSchema } from "../../../shared/notebook-snapshot-read";

export function titleCommand(
  snapshot: NotebookSnapshot,
  title: string,
): NotebookCommand {
  return {
    protocol: CONTRACT_VERSION,
    opId: crypto.randomUUID(),
    projectId: snapshot.snapshot.projectId,
    workingVersionId: snapshot.snapshot.head.versionId,
    observedHead: snapshot.snapshot.head,
    changes: [
      {
        type: "set-metadata",
        expectedMetadataRevision: snapshot.resources.metadataRevision,
        metadata: { title },
      },
    ],
  };
}

export async function applyNotebookCommand(
  command: NotebookCommand,
  recover: boolean,
) {
  const { projectId, opId } = command;
  if (recover) {
    const known = notebookOperationReadSchema.parse(
      await callAction(
        "get-notebook-operation",
        { projectId, opId },
        { method: "GET" },
      ),
    );
    if (known.status === "found") return checkedReceipt(known.receipt, command);
  }
  try {
    const result = await callAction("apply-notebook-operation", command, {
      uiOnly: true,
      keepalive: false,
    });
    return checkedReceipt(result, command);
  } catch (error) {
    const details = (error as { details?: { receipt?: unknown } } | undefined)
      ?.details;
    if (details?.receipt === undefined) throw error;
    return checkedReceipt(details.receipt, command);
  }
}

function checkedReceipt(value: unknown, command: NotebookCommand) {
  const receipt = operationReceiptSchema.parse(value);
  if (
    receipt.opId !== command.opId ||
    (receipt.status === "applied" &&
      receipt.impact.snapshot.projectId !== command.projectId)
  )
    throw new Error("Invalid notebook operation receipt.");
  return receipt;
}

export async function readTitleSnapshot(projectId: string) {
  const read = notebookSnapshotActionReadSchema.parse(
    await callAction("get-notebook-snapshot", { projectId }, { method: "GET" }),
  );
  if (read.status !== "accepted")
    throw new Error("Notebook draft is not available.");
  return read;
}
