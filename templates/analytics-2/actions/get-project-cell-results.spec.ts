import { beforeEach, describe, expect, it, vi } from "vitest";

const { readProject, getExecution, getResultPage } = vi.hoisted(() => ({
  readProject: vi.fn(),
  getExecution: vi.fn(),
  getResultPage: vi.fn(),
}));

vi.mock("./get-project.js", () => ({ default: { run: readProject } }));
vi.mock("../server/lib/workspace-access.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/workspace-access.js")
  >()),
  requireCurrentWorkspace: vi.fn().mockResolvedValue({
    ownerEmail: "reader@example.test",
    orgId: "result-shape-workspace",
  }),
}));
vi.mock("../server/model/notebook-execution/draft-state.js", () => ({
  getNotebookExecution: getExecution,
}));
vi.mock("../server/model/notebook-results.js", () => ({
  currentResultActor: vi.fn().mockResolvedValue({}),
  getNotebookResultPage: getResultPage,
}));

import getResults from "./get-project-cell-results.js";

const cell = { projectId: "prj_test", cellId: "cell_1" };
const toolContext = { caller: "tool" } as const;
const project = { cells: [{ id: cell.cellId }] };

const fourRowManifest = {
  status: "complete" as const,
  rowCount: "4",
  fields: [
    { name: "order_id", type: "string" },
    { name: "order_date", type: "date" },
    { name: "customer_id", type: "string" },
    { name: "product_id", type: "string" },
    { name: "quantity", type: "number" },
    { name: "unit_price", type: "number" },
    { name: "order_total", type: "number" },
    { name: "channel", type: "string" },
  ],
};

const fourRows = [
  ["ord_0001", "2026-01-01", "cust_1", "prod_1", 1, 10, 10, "web"],
  ["ord_0002", "2026-01-02", "cust_2", "prod_2", 2, 20, 40, "web"],
  ["ord_0003", "2026-01-03", "cust_3", "prod_3", 1, 15, 15, "store"],
  ["ord_0004", "2026-01-04", "cust_4", "prod_4", 3, 30, 90, "web"],
];

describe("saved-result-paging (get-project-cell-results)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readProject.mockResolvedValue({
      project,
      outputs: {},
      queryStates: {
        cell_1: { status: "complete", totalRows: "4", hasNextPage: false },
      },
    });
    getExecution.mockResolvedValue({
      status: "found",
      cells: {
        cell_1: {
          resultId: "res_123",
          attempt: { state: { status: "complete" } },
        },
      },
    });
    getResultPage.mockResolvedValue({
      status: "ready",
      manifest: fourRowManifest,
      rows: fourRows,
    });
  });

  it("pages saved execution artifacts without reporting false unavailable or hasNextPage mismatch", async () => {
    const first = await getResults.run(
      { ...cell, offset: 0, limit: 2 },
      toolContext,
    );
    expect(first).toMatchObject({
      status: "complete",
      totalRows: "4",
      hasNextPage: false,
      offset: 0,
      nextOffset: 2,
      output: {
        type: "table",
        columns: [
          { name: "order_id", type: "string" },
          { name: "order_date", type: "date" },
          { name: "customer_id", type: "string" },
          { name: "product_id", type: "string" },
          { name: "quantity", type: "number" },
          { name: "unit_price", type: "number" },
          { name: "order_total", type: "number" },
          { name: "channel", type: "string" },
        ],
        rowCount: 4,
        truncated: true,
      },
      preview: {
        valuesTruncated: false,
        columnsTruncated: false,
      },
    });
    expect(
      first.output?.type === "table" && first.output.rows.map((r) => r[0]),
    ).toEqual(["ord_0001", "ord_0002"]);

    const second = await getResults.run(
      { ...cell, offset: 2, limit: 2 },
      toolContext,
    );
    expect(second).toMatchObject({
      status: "complete",
      totalRows: "4",
      hasNextPage: false,
      offset: 2,
      nextOffset: null,
      output: {
        type: "table",
        columns: [
          { name: "order_id", type: "string" },
          { name: "order_date", type: "date" },
          { name: "customer_id", type: "string" },
          { name: "product_id", type: "string" },
          { name: "quantity", type: "number" },
          { name: "unit_price", type: "number" },
          { name: "order_total", type: "number" },
          { name: "channel", type: "string" },
        ],
        rowCount: 4,
        truncated: true,
      },
      preview: {
        valuesTruncated: false,
        columnsTruncated: false,
      },
    });
    expect(
      second.output?.type === "table" && second.output.rows.map((r) => r[0]),
    ).toEqual(["ord_0003", "ord_0004"]);
  });
});
