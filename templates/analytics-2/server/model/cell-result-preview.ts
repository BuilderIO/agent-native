import { fail } from "@agent-native/core/action";
import { z } from "zod";

import type { CellOutput } from "../../app/lib/model/contracts.js";

export const resultPreviewSchema = z.object({
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  valuesTruncated: z.boolean(),
  columnsTruncated: z.boolean(),
  returnedRows: z.number().int().nonnegative(),
  totalRows: z.string().regex(/^\d+$/).nullable(),
  partial: z.boolean(),
  partialNote: z.string().optional(),
});

export const PARTIAL_RESULT_NOTE =
  "These rows are a partial page of the result, not a representative sample. Do not infer absence, extremes, grain, counts, sums, or averages from this preview; compute aggregates in a SQL cell over the full data.";

export function previewNotebookResultPage(result: {
  manifest:
    | { status: "complete" | "complete-empty"; rowCount: string }
    | { status: "incomplete"; verifiedRowCount: string }
    | { status: "pending" };
  page: number;
  rows: readonly unknown[];
}): z.infer<typeof resultPreviewSchema> {
  const PAGE_ROWS = 50;
  const offset = (result.page - 1) * PAGE_ROWS;
  const returnedRows = result.rows.length;
  const totalRows =
    result.manifest.status === "complete" ||
    result.manifest.status === "complete-empty"
      ? result.manifest.rowCount
      : result.manifest.status === "incomplete"
        ? result.manifest.verifiedRowCount
        : null;
  const nextOffset =
    totalRows !== null && BigInt(totalRows) > BigInt(offset + returnedRows)
      ? offset + returnedRows
      : null;
  const partial =
    result.manifest.status === "incomplete" ||
    offset > 0 ||
    nextOffset !== null ||
    (totalRows !== null && BigInt(totalRows) > BigInt(returnedRows));
  return {
    offset,
    nextOffset,
    valuesTruncated: false,
    columnsTruncated: false,
    returnedRows,
    totalRows,
    partial,
    ...(partial ? { partialNote: PARTIAL_RESULT_NOTE } : {}),
  };
}

export function previewCellOutput(
  output: CellOutput | null,
  offset = 0,
  limit = 50,
  options?: { baseOffset?: number; totalRows?: string | null },
) {
  if (!output) return { output, preview: null };
  if (output.type !== "table") {
    if (output.type === "error") {
      if (JSON.stringify(output).length <= 10_000)
        return { output, preview: null };
      fail("The cell error is too large to return in a bounded result.", {
        statusCode: 422,
        errorCode: "cell_output_too_large",
      });
    }
    fail(
      "This cell output is not a table and cannot be paged by this action.",
      {
        statusCode: 422,
        errorCode: "cell_output_not_tabular",
      },
    );
  }
  const columns = output.columns;
  const schemaSize = JSON.stringify(columns, null, 2).length;
  if (schemaSize > 10_000)
    fail("The result schema is too large to return in a bounded result.", {
      statusCode: 422,
      errorCode: "cell_output_schema_too_large",
    });
  let valuesTruncated = false;
  const rows: typeof output.rows = [];
  for (const sourceRow of output.rows.slice(offset, offset + limit)) {
    let rowTruncated = false;
    const row = sourceRow.map((value, index) => {
      if (typeof value !== "string" || value.length <= 2_000) return value;
      // Exact numeric strings must not be shortened into a different number.
      if (columns[index]?.type === "number")
        fail("A numeric result value is too large to return exactly.", {
          statusCode: 422,
          errorCode: "cell_output_value_too_large",
        });
      rowTruncated = true;
      return value.slice(0, 2_000);
    });
    const size = JSON.stringify(
      { columns, rows: [...rows, row] },
      null,
      2,
    ).length;
    if (size > 25_000) {
      if (rows.length === 0)
        fail("A result row is too large to return in a bounded page.", {
          statusCode: 422,
          errorCode: "cell_output_row_too_large",
        });
      break;
    }
    valuesTruncated ||= rowTruncated;
    rows.push(row);
  }
  const baseOffset = options?.baseOffset ?? 0;
  const end = offset + rows.length;
  const nextOffset = end < output.rows.length ? baseOffset + end : null;
  const fallbackTotal =
    options?.totalRows != null && /^\d+$/.test(options.totalRows)
      ? options.totalRows
      : null;
  const totalRows =
    output.totalRows ??
    fallbackTotal ??
    (output.truncated || baseOffset > 0 ? null : String(output.rows.length));
  const knownTotalExceedsReturned =
    totalRows !== null && BigInt(totalRows) > BigInt(rows.length);
  const partial =
    output.truncated ||
    nextOffset !== null ||
    offset > 0 ||
    baseOffset > 0 ||
    valuesTruncated ||
    knownTotalExceedsReturned;
  return {
    output: {
      ...output,
      columns,
      rows,
      truncated: partial,
    },
    preview: {
      offset: baseOffset + offset,
      nextOffset,
      valuesTruncated,
      columnsTruncated: false,
      returnedRows: rows.length,
      totalRows,
      partial,
      ...(partial ? { partialNote: PARTIAL_RESULT_NOTE } : {}),
    },
  };
}
