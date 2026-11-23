import { isActionContractError } from "@agent-native/core/action";

import { assertConnectionResultsAccess } from "./data-connections.js";
import { withoutDataframeReference } from "./dataframe-materialization.js";
import { type CellOutputRecord, readProjectOutputs } from "./runs-store.js";
import type { WorkspaceScope } from "./scope.js";

const UNAVAILABLE_MESSAGE =
  "You do not have access to view results from this data connection.";

type AccessibleOutput = CellOutputRecord & {
  accessStatus?: "denied" | "unreadable";
};

/**
 * A project's saved results as this account may see them, and the one place
 * that decides it. A result with no recorded connection, from a connection this
 * account cannot read, or built from a dataframe whose own upstream connection
 * it cannot read, is replaced by an error. What survives has its private
 * dataframe reference removed. readProjectOutputs alone returns raw stored
 * rows (and, by default, strips the private fields), so every reader of saved
 * results goes through here: get-project, components and dynamic inputs.
 */
export async function readAccessibleProjectOutputs(
  scope: Partial<WorkspaceScope>,
  projectId: string,
  versionId: string | undefined,
  cellIds: ReadonlySet<string>,
  caller = "unknown",
): Promise<Record<string, AccessibleOutput>> {
  const outputs: Record<string, AccessibleOutput> = {};
  for (const [cellId, output] of Object.entries(
    await readProjectOutputs(scope, projectId, versionId, {
      includeDataframeReferences: true,
      cellIds: [...cellIds],
    }),
  )) {
    if (cellIds.has(cellId)) outputs[cellId] = output;
  }
  const denied = (
    output: CellOutputRecord,
    message: string,
    accessStatus: "denied" | "unreadable",
  ): AccessibleOutput => ({
    ...output,
    accessStatus,
    status: "error" as const,
    output: { type: "error" as const, message, detail: null },
  });
  const permissions = new Map<string, boolean>();
  for (const [cellId, output] of Object.entries(outputs)) {
    if (!output.connectionProvenanceRecorded) {
      outputs[cellId] = denied(
        output,
        "Run this cell again to verify access to its results.",
        "unreadable",
      );
      continue;
    }
    const materialization =
      output.output?.type === "table"
        ? output.output.materialization
        : undefined;
    if (
      (output.sourceConnectionId !== null &&
        !output.sourceConnectionId.trim()) ||
      materialization?.dependencies.some(
        ({ connectionId }) => connectionId !== null && !connectionId.trim(),
      )
    ) {
      outputs[cellId] = denied(
        output,
        "Run this cell again to verify access to its results.",
        "unreadable",
      );
      continue;
    }
    const connectionIds = new Set([
      ...(output.sourceConnectionId ? [output.sourceConnectionId] : []),
      ...(materialization?.dependencies.flatMap((dependency) =>
        dependency.connectionId ? [dependency.connectionId] : [],
      ) ?? []),
    ]);
    let accessible = true;
    for (const connectionId of connectionIds) {
      let allowed = permissions.get(connectionId);
      if (allowed === undefined) {
        try {
          await assertConnectionResultsAccess(connectionId, caller);
          allowed = true;
        } catch (error) {
          if (!isActionContractError(error) || error.statusCode >= 500)
            throw error;
          allowed = false;
        }
        permissions.set(connectionId, allowed);
      }
      if (!allowed) {
        accessible = false;
        break;
      }
    }
    outputs[cellId] = accessible
      ? { ...output, output: withoutDataframeReference(output.output) }
      : denied(output, UNAVAILABLE_MESSAGE, "denied");
  }
  return outputs;
}
