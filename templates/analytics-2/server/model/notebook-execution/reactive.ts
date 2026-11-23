import { and, eq } from "drizzle-orm";

import { notebookCellIdSchema } from "../../../shared/notebook-snapshot-contract.js";
import type { Queryable } from "../scope.js";
import { notebookReactiveInputs } from "./schema.js";

function projectVersion(projectId: string, versionId: string) {
  return and(
    eq(notebookReactiveInputs.projectId, projectId),
    eq(notebookReactiveInputs.versionId, versionId),
  );
}

export async function pendingReactiveInputs(
  tx: Queryable,
  projectId: string,
  versionId: string,
) {
  const [pending] = await tx
    .select()
    .from(notebookReactiveInputs)
    .where(projectVersion(projectId, versionId))
    .limit(1);
  return pending;
}

export async function enqueueReactiveInputs(
  tx: Queryable,
  projectId: string,
  versionId: string,
  inputIds: string[],
) {
  const pending = await pendingReactiveInputs(tx, projectId, versionId);
  const inputCellIds = [
    ...new Set([
      ...(pending?.inputCellIds ?? []),
      ...inputIds.map((id) => notebookCellIdSchema.parse(id)),
    ]),
  ];
  await tx
    .insert(notebookReactiveInputs)
    .values({ projectId, versionId, inputCellIds })
    .onConflictDoUpdate({
      target: notebookReactiveInputs.projectId,
      set: { versionId, inputCellIds },
    });
}

export async function consumeReactiveInputs(
  tx: Queryable,
  projectId: string,
  versionId?: string,
) {
  await tx
    .delete(notebookReactiveInputs)
    .where(
      versionId === undefined
        ? eq(notebookReactiveInputs.projectId, projectId)
        : projectVersion(projectId, versionId),
    );
}
