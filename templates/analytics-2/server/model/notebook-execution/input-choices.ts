import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { resultIdSchema } from "../../../shared/notebook-execution.js";
import { notebookCellIdSchema } from "../../../shared/notebook-snapshot-contract.js";
import { getDb } from "../../db/index.js";
import { readNotebookResultChoices } from "../notebook-results.js";
import type { Queryable, WorkspaceScope } from "../scope.js";
import { notebookOutputs, notebookRunWork } from "./schema.js";
import {
  draftNamespace,
  readCurrentDraftSnapshot,
  type ExecutionActor,
} from "./snapshot.js";

export const getNotebookInputChoicesOutput = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ready"),
    resultId: resultIdSchema,
    values: z.array(z.strictObject({ value: z.string(), label: z.string() })),
  }),
  z.strictObject({
    status: z.enum(["missing", "pending", "empty", "denied", "unreadable"]),
  }),
]);

export async function inputOptionsPointer(
  tx: Queryable,
  scope: WorkspaceScope,
  projectId: string,
  cellId: string,
) {
  const [pointer] = await tx
    .select({
      resultId: notebookOutputs.resultId,
      pending: notebookRunWork.runId,
    })
    .from(notebookOutputs)
    .leftJoin(
      notebookRunWork,
      and(
        eq(notebookRunWork.attemptId, notebookOutputs.attemptId),
        eq(notebookRunWork.done, false),
      ),
    )
    .where(
      and(
        eq(
          notebookOutputs.namespaceId,
          draftNamespace(scope, projectId).namespaceId,
        ),
        eq(notebookOutputs.cellId, notebookCellIdSchema.parse(cellId)),
      ),
    )
    .limit(1);
  return pointer;
}

export async function getNotebookInputChoices(
  actor: ExecutionActor,
  projectId: string,
  cellId: string,
): Promise<z.infer<typeof getNotebookInputChoicesOutput>> {
  const loaded = await readCurrentDraftSnapshot(actor, projectId);
  if (loaded.status !== "accepted")
    return { status: loaded.status === "absent" ? "missing" : "unreadable" };
  const { cells } = loaded.value;
  const inputIndex = cells.findIndex(({ id }) => id === cellId);
  const contents = cells[inputIndex]?.contents;
  if (contents?.kind !== "input" || !contents.dynamicOptions)
    return { status: "missing" };
  const { producerCellId, valueFieldId, displayFieldId } =
    contents.dynamicOptions;
  if (
    !cells
      .slice(0, inputIndex)
      .some(
        ({ id, contents }) =>
          id === producerCellId && contents.kind !== "input",
      )
  )
    return { status: "missing" };
  const pointer = await inputOptionsPointer(
    getDb(),
    actor,
    projectId,
    producerCellId,
  );
  if (!pointer?.resultId)
    return { status: pointer?.pending ? "pending" : "missing" };
  return readNotebookResultChoices(
    actor,
    pointer.resultId,
    valueFieldId,
    displayFieldId,
  );
}
