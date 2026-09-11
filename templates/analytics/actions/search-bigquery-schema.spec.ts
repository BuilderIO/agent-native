import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  getBigQueryProjectId: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("../server/lib/bigquery", () => ({
  getBigQueryProjectId: mocks.getBigQueryProjectId,
}));
vi.mock("../server/lib/gcloud", () => ({
  getAccessToken: mocks.getAccessToken,
}));

const action = (await import("./search-bigquery-schema")).default;

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  mocks.getAccessToken.mockReset();
  mocks.getBigQueryProjectId.mockReset();
  mocks.fetch.mockReset();
  mocks.getAccessToken.mockResolvedValue("test-token");
  mocks.getBigQueryProjectId.mockResolvedValue("test-project");
  vi.stubGlobal("fetch", mocks.fetch);

  mocks.fetch.mockImplementation(async (input: URL | string) => {
    const url = new URL(String(input));
    const path = url.pathname;

    if (path.endsWith("/datasets")) {
      return jsonResponse({
        datasets: [
          {
            datasetReference: {
              projectId: "test-project",
              datasetId: "product",
            },
          },
        ],
      });
    }

    if (path.endsWith("/datasets/product/tables")) {
      return jsonResponse({
        tables: [
          {
            tableReference: {
              projectId: "test-project",
              datasetId: "product",
              tableId: "branch_creation",
            },
            type: "TABLE",
          },
          {
            tableReference: {
              projectId: "test-project",
              datasetId: "product",
              tableId: "ai_credit_usage",
            },
            type: "TABLE",
          },
        ],
      });
    }

    if (path.endsWith("/datasets/product/tables/branch_creation")) {
      return jsonResponse({
        tableReference: {
          projectId: "test-project",
          datasetId: "product",
          tableId: "branch_creation",
        },
        schema: {
          fields: [
            { name: "created_at", type: "TIMESTAMP" },
            { name: "created_by_user_id", type: "STRING" },
          ],
        },
      });
    }

    if (path.endsWith("/datasets/product/tables/ai_credit_usage")) {
      return jsonResponse({
        tableReference: {
          projectId: "test-project",
          datasetId: "product",
          tableId: "ai_credit_usage",
        },
        schema: {
          fields: [
            { name: "user_id", type: "STRING" },
            { name: "credits_consumed", type: "NUMERIC" },
          ],
        },
      });
    }

    return jsonResponse(
      { error: { message: "unexpected metadata request" } },
      404,
    );
  });
});

describe("search-bigquery-schema", () => {
  it("searches tables and columns across the configured project without a dataset", async () => {
    const result = await action.run({ search: "credit", limit: 10 });

    expect(result).toMatchObject({
      mode: "table-search",
      projectId: "test-project",
      datasetsScanned: 1,
      tablesScanned: 2,
      truncated: false,
    });
    expect(result.tables).toEqual([
      expect.objectContaining({
        datasetId: "product",
        tableId: "ai_credit_usage",
        columns: expect.arrayContaining([
          expect.objectContaining({ name: "credits_consumed" }),
        ]),
      }),
    ]);
  });

  it("finds a table from a column term when the table name is generic", async () => {
    const result = await action.run({ search: "created by", limit: 10 });

    expect(result.tables).toEqual([
      expect.objectContaining({
        datasetId: "product",
        tableId: "branch_creation",
        columns: expect.arrayContaining([
          expect.objectContaining({ name: "created_by_user_id" }),
        ]),
      }),
    ]);
  });

  it("keeps the no-argument call as a lightweight dataset listing", async () => {
    const result = await action.run({});

    expect(result).toMatchObject({
      mode: "datasets",
      datasets: [{ datasetId: "product" }],
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
