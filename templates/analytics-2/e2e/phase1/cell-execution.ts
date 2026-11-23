import { z } from "zod";

import { cellRunReceiptSchema } from "../../shared/notebook-execution.js";
import { kernelOutputSchema } from "../../shared/notebook-kernel-output.js";
import { readCompletedResultPage } from "./execution-readback.js";
import type { FlowContext } from "./runtime.js";

const currentExecution = z.object({
  status: z.literal("found"),
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  state: cellRunReceiptSchema.shape.state,
  resultId: z.string().min(1).nullable(),
  kernelGeneration: z.string().min(1).nullable(),
  outputs: z.array(kernelOutputSchema),
});

export async function readCellExecution(
  flow: Pick<FlowContext, "action">,
  projectId: string,
  cellId: string,
) {
  return currentExecution.parse(
    await flow.action("get-notebook-cell-execution", { projectId, cellId }),
  );
}

export async function readCompleteCellRows(
  flow: Pick<FlowContext, "action">,
  projectId: string,
  cellId: string,
  rowCount: string,
  runId?: string,
  resultId?: string,
) {
  const execution = await readCellExecution(flow, projectId, cellId);
  const id = resultId ?? execution.resultId;
  if (
    !id ||
    (runId !== undefined && execution.runId !== runId) ||
    execution.state.status !== "complete" ||
    !execution.state.resultIds.some((candidate) => candidate === id)
  ) {
    throw new Error("The current attempt did not complete with this result");
  }
  const { manifest, rows } = readCompletedResultPage(
    await flow.action("get-notebook-result-page", { resultId: id, page: 1 }),
    1,
    rowCount,
    id,
  );
  const { producer } = manifest.result;
  if (
    producer.cellId !== cellId ||
    producer.runId !== execution.runId ||
    producer.attemptId !== execution.attemptId
  ) {
    throw new Error("The stored result was produced by a different attempt");
  }
  return rows;
}
