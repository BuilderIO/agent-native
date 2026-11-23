import { expect, it } from "vitest";

import type { CellOutput } from "../../app/lib/model/contracts.js";
import {
  PARTIAL_RESULT_NOTE,
  previewCellOutput,
  previewNotebookResultPage,
} from "./cell-result-preview.js";

function table(
  rowCount: number,
  extra: Partial<Extract<CellOutput, { type: "table" }>> = {},
): CellOutput {
  return {
    type: "table",
    columns: [{ name: "n", type: "number" }],
    rows: Array.from({ length: rowCount }, (_, index) => [index]),
    rowCount,
    truncated: false,
    ...extra,
  } as CellOutput;
}

it("report QA-1794950687.488649 marks a paged result as partial with typed coverage and an aggregate warning", () => {
  const { preview } = previewCellOutput(table(120));
  expect(preview).toMatchObject({
    returnedRows: 50,
    totalRows: "120",
    partial: true,
    nextOffset: 50,
  });
  expect(preview?.partialNote).toMatch(/aggregates in a SQL cell/);
});

it("report QA-1794950687.488649 flags a warehouse-truncated result and reports its real total", () => {
  const { preview } = previewCellOutput(
    table(10, { truncated: true, totalRows: "250000" }),
  );
  expect(preview).toMatchObject({
    returnedRows: 10,
    totalRows: "250000",
    partial: true,
  });
});

it("report QA-1794950687.488649 does not flag a complete result as partial", () => {
  const { preview } = previewCellOutput(table(5));
  expect(preview).toMatchObject({
    returnedRows: 5,
    totalRows: "5",
    partial: false,
  });
  expect(preview?.partialNote).toBeUndefined();
});

it("report SAYA-1117-PREVIEW-INFERENCE warns against inferring absence, extremes, or grain from a partial preview", () => {
  expect(PARTIAL_RESULT_NOTE).toMatch(/not a representative sample/i);
  expect(PARTIAL_RESULT_NOTE).toMatch(/absence/i);
  expect(PARTIAL_RESULT_NOTE).toMatch(/extremes|min\/max/i);
  expect(PARTIAL_RESULT_NOTE).toMatch(/grain/i);
});

it("report SAYA-1117-PREVIEW-INFERENCE marks multi-page and incomplete notebook result pages as partial", () => {
  const completePage1 = previewNotebookResultPage({
    manifest: { status: "complete", rowCount: "150" },
    page: 1,
    rows: Array.from({ length: 50 }, (_, i) => [i]),
  });
  expect(completePage1).toEqual({
    offset: 0,
    nextOffset: 50,
    valuesTruncated: false,
    columnsTruncated: false,
    returnedRows: 50,
    totalRows: "150",
    partial: true,
    partialNote: PARTIAL_RESULT_NOTE,
  });

  const completePage3 = previewNotebookResultPage({
    manifest: { status: "complete", rowCount: "150" },
    page: 3,
    rows: Array.from({ length: 50 }, (_, i) => [i + 100]),
  });
  expect(completePage3).toMatchObject({
    offset: 100,
    nextOffset: null,
    returnedRows: 50,
    totalRows: "150",
    partial: true,
    partialNote: PARTIAL_RESULT_NOTE,
  });

  const incompletePage = previewNotebookResultPage({
    manifest: { status: "incomplete", verifiedRowCount: "40" },
    page: 1,
    rows: Array.from({ length: 40 }, (_, i) => [i]),
  });
  expect(incompletePage).toMatchObject({
    offset: 0,
    nextOffset: null,
    returnedRows: 40,
    totalRows: "40",
    partial: true,
    partialNote: PARTIAL_RESULT_NOTE,
  });

  const completeSinglePage = previewNotebookResultPage({
    manifest: { status: "complete", rowCount: "5" },
    page: 1,
    rows: Array.from({ length: 5 }, (_, i) => [i]),
  });
  expect(completeSinglePage).toEqual({
    offset: 0,
    nextOffset: null,
    valuesTruncated: false,
    columnsTruncated: false,
    returnedRows: 5,
    totalRows: "5",
    partial: false,
  });
});
