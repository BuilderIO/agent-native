import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  cellOutputSchema,
  type CellOutput,
} from "../app/lib/model/contracts.js";
import {
  previewCellOutput,
  resultPreviewSchema,
} from "../server/model/cell-result-preview.js";
import { getNotebookExecution } from "../server/model/notebook-execution/draft-state.js";
import { currentExecutionActor } from "../server/model/notebook-execution/service.js";
import {
  currentResultActor,
  getNotebookResultPage,
} from "../server/model/notebook-results.js";
import getProject from "./get-project.js";

function mapArtifactColumnType(
  type: string,
): "string" | "number" | "boolean" | "date" | "datetime" | "null" {
  switch (type) {
    case "number":
    case "integer":
    case "decimal":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "datetime":
    case "time":
      return "datetime";
    case "null":
      return "null";
    default:
      return "string";
  }
}

function mapArtifactCellValue(
  value: unknown,
): string | number | boolean | null {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "value" in value
  ) {
    const tagged = value as { type?: unknown; value?: unknown };
    if (
      (tagged.type === "integer" || tagged.type === "decimal") &&
      typeof tagged.value === "string"
    ) {
      const parsed = Number(tagged.value);
      return Number.isSafeInteger(parsed) || tagged.type === "decimal"
        ? Number.isFinite(parsed)
          ? parsed
          : tagged.value
        : tagged.value;
    }
    if (typeof tagged.value === "string") return tagged.value;
  }
  return JSON.stringify(value);
}

const resultStatusSchema = z.enum([
  "not_run",
  "queued",
  "running",
  "cancelling",
  "cancel_unknown",
  "cancelled",
  "complete",
  "error",
  "unavailable",
]);

export default defineAction({
  description:
    "Read a bounded page of a project cell's saved results and its current query status. These rows are a first-N preview, not a representative sample: never infer absence, extremes, or grain from them.",
  schema: z
    .object({
      projectId: z.string().min(1),
      cellId: z.string().min(1),
      offset: z.coerce
        .number()
        .int()
        .nonnegative()
        .default(0)
        .describe(
          "Zero-based offset into the rows already loaded; defaults to 0.",
        ),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(50)
        .default(50)
        .describe("Maximum rows to return, from 1 to 50; defaults to 50."),
    })
    .strict(),
  outputSchema: z.object({
    status: resultStatusSchema,
    output: cellOutputSchema.nullable(),
    totalRows: z.string().nullable(),
    hasNextPage: z.boolean(),
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
    preview: resultPreviewSchema.nullable(),
  }),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async ({ projectId, cellId, offset = 0, limit = 50 }, context) => {
    const result = await getProject.run({ projectId }, context);
    if (!result.project.cells.some((cell) => cell.id === cellId))
      fail("That cell is not in this project.", {
        statusCode: 404,
        errorCode: "project_cell_not_found",
      });
    const record = result.outputs[cellId] as
      | (typeof result.outputs)[string]
      | undefined;
    const state = result.queryStates[cellId] as
      | (typeof result.queryStates)[string]
      | undefined;
    let status: z.infer<typeof resultStatusSchema> =
      state && state.status !== "complete"
        ? state.status
        : record?.status === "error"
          ? "error"
          : (state?.status ?? record?.status ?? "not_run");
    let output: CellOutput | null =
      status === "complete"
        ? (record?.output ?? null)
        : status === "error" && record?.output?.type === "error"
          ? record.output
          : null;
    let sliceOffset = offset;
    let baseOffset = 0;
    let artifactTotalRows: string | null = null;
    let artifactHasNextPage = false;

    if (
      !output &&
      status !== "running" &&
      status !== "queued" &&
      status !== "cancelling"
    ) {
      const caller = context?.caller ?? "unknown";
      const execActor = await currentExecutionActor(caller);
      const execution = await getNotebookExecution(execActor, projectId);
      const cellExec =
        execution.status === "found" ? execution.cells[cellId] : undefined;
      if (cellExec?.resultId && cellExec.attempt?.state.status === "complete") {
        const resultActor = await currentResultActor(caller);
        const pageNum = Math.floor(offset / 50) + 1;
        const startInPage = offset % 50;
        const firstPage = await getNotebookResultPage(resultActor, {
          resultId: cellExec.resultId,
          page: pageNum,
        });
        if (firstPage.status === "ready") {
          const manifest = firstPage.manifest;
          const totalRowsStr =
            manifest.status === "complete" ||
            manifest.status === "complete-empty"
              ? manifest.rowCount
              : manifest.status === "incomplete"
                ? manifest.verifiedRowCount
                : null;
          let combinedRows = firstPage.rows.map((r) =>
            r.map(mapArtifactCellValue),
          );
          if (startInPage + limit > 50 && firstPage.rows.length === 50) {
            const secondPage = await getNotebookResultPage(resultActor, {
              resultId: cellExec.resultId,
              page: pageNum + 1,
            });
            if (secondPage.status === "ready") {
              combinedRows = combinedRows.concat(
                secondPage.rows.map((r) => r.map(mapArtifactCellValue)),
              );
            }
          }
          const totalNum =
            totalRowsStr != null ? Number(totalRowsStr) : combinedRows.length;
          status = "complete";
          baseOffset = (pageNum - 1) * 50;
          sliceOffset = startInPage;
          artifactTotalRows = totalRowsStr;
          artifactHasNextPage =
            manifest.status === "incomplete" ||
            baseOffset + combinedRows.length < totalNum;
          output = {
            type: "table",
            columns: manifest.fields.map((f) => ({
              name: f.name,
              type: mapArtifactColumnType(f.type),
            })),
            rows: combinedRows,
            rowCount: Number.isFinite(totalNum)
              ? totalNum
              : combinedRows.length,
            truncated: artifactHasNextPage,
            ...(totalRowsStr != null ? { totalRows: totalRowsStr } : {}),
          };
        }
      }
    }

    if (status === "complete" && !output) status = "unavailable";

    const page = previewCellOutput(output, sliceOffset, limit, {
      baseOffset,
      totalRows: artifactTotalRows,
    });
    return {
      status,
      output: page.output,
      totalRows:
        state?.totalRows ??
        artifactTotalRows ??
        (output?.type === "table"
          ? (output.totalRows ??
            (!output.truncated ? String(output.rowCount) : null))
          : null),
      hasNextPage:
        state?.hasNextPage ??
        (artifactTotalRows != null
          ? artifactHasNextPage
          : output?.type === "table" && output.truncated),
      offset,
      nextOffset: page.preview?.nextOffset ?? null,
      preview: page.preview,
    };
  },
});
