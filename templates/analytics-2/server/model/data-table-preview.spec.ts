import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  metadata: vi.fn(),
  connection: vi.fn(),
  query: vi.fn(),
}));
vi.mock("./data-table-details.js", () => ({
  getDataTableDetails: state.metadata,
}));
vi.mock("./data-connections.js", () => ({
  readBrowsableDataConnection: state.connection,
  executeConnectionQuery: state.query,
}));
vi.mock("../lib/workspace-access.js", () => ({
  requireCurrentWorkspace: async () => ({
    ownerEmail: "qa@example.test",
    orgId: "org-qa",
  }),
}));

import { getDataTablePreview } from "./data-table-preview.js";

const input = {
  connectionId: "qa-connection",
  tableId: "table:project:dataset:orders",
};
const table = { projectId: "project", datasetId: "dataset", tableId: "orders" };
beforeEach(() => {
  vi.clearAllMocks();
  state.metadata.mockResolvedValue({ connectionId: input.connectionId, table });
  state.connection.mockResolvedValue({ id: input.connectionId, config: {} });
  state.query.mockResolvedValue({
    jobComplete: true,
    columns: [{ name: "id", type: "STRING" }],
    rows: [["one"]],
    hasNextPage: false,
  });
});

it("returns at most 50 rows from the authorized table and rechecks access after the read", async () => {
  const result = await getDataTablePreview(input, "frontend");
  expect(result.rows).toEqual([["one"]]);
  expect(state.query).toHaveBeenCalledWith(
    expect.objectContaining({
      connectionId: input.connectionId,
      query: "SELECT * FROM `project.dataset.orders` LIMIT 50",
      first: 50,
    }),
    expect.objectContaining({ caller: "frontend" }),
  );
  expect(state.metadata).toHaveBeenCalledTimes(2);
});

it("does not issue a preview when disabled and refuses incomplete results", async () => {
  state.connection.mockResolvedValueOnce({
    id: input.connectionId,
    config: { disableTablePreviews: true },
  });
  await expect(getDataTablePreview(input, "frontend")).rejects.toThrow();
  expect(state.query).not.toHaveBeenCalled();
  state.connection.mockResolvedValue({ id: input.connectionId, config: {} });
  state.query.mockResolvedValue({ jobComplete: false, rows: [], columns: [] });
  await expect(getDataTablePreview(input, "frontend")).rejects.toThrow();
});

it("does not interpolate provider identifiers containing SQL delimiters", async () => {
  state.metadata.mockResolvedValue({
    connectionId: input.connectionId,
    table: { ...table, tableId: "orders` WHERE true --" },
  });
  await expect(getDataTablePreview(input, "frontend")).rejects.toThrow();
  expect(state.query).not.toHaveBeenCalled();
});

it("withholds rows if preview permission changes during the read", async () => {
  state.connection
    .mockResolvedValueOnce({ id: input.connectionId, config: {} })
    .mockResolvedValueOnce({
      id: input.connectionId,
      config: { disableTablePreviews: true },
    });
  await expect(getDataTablePreview(input, "frontend")).rejects.toThrow();
  expect(state.query).toHaveBeenCalledOnce();
});

it("withholds rows when access is revoked during the query", async () => {
  state.metadata
    .mockResolvedValueOnce({ connectionId: input.connectionId, table })
    .mockRejectedValueOnce(new Error("access revoked"));
  await expect(getDataTablePreview(input, "frontend")).rejects.toThrow(
    "access revoked",
  );
});

it("returns a successful empty result without treating it as an error", async () => {
  state.query.mockResolvedValue({
    jobComplete: true,
    columns: [{ name: "id", type: "STRING" }],
    rows: [],
    hasNextPage: false,
  });
  await expect(getDataTablePreview(input, "frontend")).resolves.toMatchObject({
    columns: ["id"],
    rows: [],
  });
});

it("previews real built-in sample rows without a warehouse call", async () => {
  const sampleInput = {
    connectionId: "builtin-sample-data",
    tableId: "table:sample:PUBLIC:customers",
  };
  state.metadata.mockResolvedValue({
    connectionId: sampleInput.connectionId,
    table: { ...table, tableId: "customers" },
  });
  state.connection.mockResolvedValue({
    id: sampleInput.connectionId,
    config: {},
  });
  const result = await getDataTablePreview(sampleInput, "frontend");
  expect(result.columns).toContain("customer_id");
  expect(result.rows.length).toBe(12);
  expect(state.query).not.toHaveBeenCalled();
});
