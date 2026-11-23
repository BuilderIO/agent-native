import { z } from "zod";

import { expect, test } from "./fixtures";
import {
  cellAt,
  editorOf,
  MOD,
  openNotebook,
  rowsSummary,
  SAMPLE_CONNECTION,
  sampleSql,
  seedNotebook,
} from "./notebook.helpers";

const pageSchema = z.object({
  status: z.literal("complete"),
  output: z.object({
    type: z.literal("table"),
    columns: z.array(z.object({ name: z.string(), type: z.string() })),
    rows: z.array(
      z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
    ),
    rowCount: z.number(),
    truncated: z.boolean(),
  }),
  totalRows: z.string(),
  hasNextPage: z.boolean(),
  offset: z.number(),
  nextOffset: z.number().nullable(),
  preview: z.object({
    offset: z.number(),
    nextOffset: z.number().nullable(),
    valuesTruncated: z.boolean(),
    columnsTruncated: z.boolean(),
  }),
});

test("report SAYA-1117-RESULT-PAGING: pages saved results without changing the notebook table", async ({
  daily,
}, testInfo) => {
  const nb = await seedNotebook(daily, [
    { kind: "sql", text: sampleSql(4), connection: SAMPLE_CONNECTION },
  ]);
  const cellId = nb.cellIds[0];
  if (!cellId) throw new Error("Expected a seeded SQL cell");
  await openNotebook(daily, nb);
  const cell = cellAt(daily.page, 0);
  await editorOf(cell).focus();
  await daily.press(`${MOD}+Enter`);
  await expect(cell.locator(".nb-output-title")).toHaveText(rowsSummary(4), {
    timeout: 15_000,
  });
  const tableRows = cell.locator(".nb-table tbody tr");
  await expect(tableRows).toHaveCount(4);
  const ids = ["ord_0001", "ord_0002", "ord_0003", "ord_0004"];
  await expect(tableRows.locator("td:first-of-type")).toHaveText(ids);

  const first = pageSchema.parse(
    await daily.action(
      "get-project-cell-results",
      { projectId: nb.id, cellId, offset: 0, limit: 2 },
      "GET",
    ),
  );
  const second = pageSchema.parse(
    await daily.action(
      "get-project-cell-results",
      { projectId: nb.id, cellId, offset: 2, limit: 2 },
      "GET",
    ),
  );
  expect(first.output.columns).toEqual([
    { name: "order_id", type: "string" },
    { name: "order_date", type: "date" },
    { name: "customer_id", type: "string" },
    { name: "product_id", type: "string" },
    { name: "quantity", type: "number" },
    { name: "unit_price", type: "number" },
    { name: "order_total", type: "number" },
    { name: "channel", type: "string" },
  ]);
  expect(second.output.columns).toEqual(first.output.columns);
  expect(first).toMatchObject({
    totalRows: "4",
    hasNextPage: false,
    offset: 0,
    nextOffset: 2,
    preview: {
      offset: 0,
      nextOffset: 2,
      valuesTruncated: false,
      columnsTruncated: false,
    },
    output: { rowCount: 4, truncated: true },
  });
  expect(second).toMatchObject({
    totalRows: "4",
    hasNextPage: false,
    offset: 2,
    nextOffset: null,
    preview: {
      offset: 2,
      nextOffset: null,
      valuesTruncated: false,
      columnsTruncated: false,
    },
    output: { rowCount: 4, truncated: true },
  });
  expect(first.output.rows.map((row) => row[0])).toEqual(ids.slice(0, 2));
  expect(second.output.rows.map((row) => row[0])).toEqual(ids.slice(2));
  await expect(tableRows.locator("td:first-of-type")).toHaveText(ids);
  await daily.reload();
  await expect(cell.locator(".nb-output-title")).toHaveText(rowsSummary(4));
  await expect(tableRows.locator("td:first-of-type")).toHaveText(ids);
  await daily.page.screenshot({
    path: testInfo.outputPath("saved-results.png"),
  });
});
