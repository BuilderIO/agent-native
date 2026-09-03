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
  isRestrictedBigQueryDataset: (datasetId: string) =>
    ["dbt_dev", "dbt_backup"].includes(datasetId.trim().toLowerCase()),
  enforceBigQueryRestrictedDatasetPolicy: (
    datasetId: string,
    options?: { restrictedSchemaAccess?: string },
  ) => {
    const normalized = datasetId.trim().toLowerCase();
    if (
      ["dbt_dev", "dbt_backup"].includes(normalized) &&
      options?.restrictedSchemaAccess !== "user-explicit-request"
    ) {
      const error = new Error(
        `BigQuery dataset "${normalized}" is restricted.`,
      ) as Error & { code: string; datasetId: string };
      error.code = "bigquery_restricted_schema";
      error.datasetId = normalized;
      throw error;
    }
  },
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
          {
            datasetReference: {
              projectId: "test-project",
              datasetId: "dbt_dev",
            },
          },
          {
            datasetReference: {
              projectId: "test-project",
              datasetId: "dbt_backup",
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

    if (path.endsWith("/datasets/dbt_backup/tables")) {
      return jsonResponse({
        tables: [
          {
            tableReference: {
              projectId: "test-project",
              datasetId: "dbt_backup",
              tableId: "archived_signups",
            },
            type: "TABLE",
          },
        ],
      });
    }

    if (path.endsWith("/datasets/dbt_backup/tables/archived_signups")) {
      return jsonResponse({
        tableReference: {
          projectId: "test-project",
          datasetId: "dbt_backup",
          tableId: "archived_signups",
        },
        schema: { fields: [{ name: "created_at", type: "TIMESTAMP" }] },
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

  it("keeps restricted datasets out of no-argument and global searches", async () => {
    const datasetsResult = await action.run({});
    const searchResult = await action.run({ search: "created", limit: 10 });

    expect(datasetsResult).toMatchObject({
      mode: "datasets",
      datasets: [{ datasetId: "product" }],
    });
    expect(searchResult.datasetsScanned).toBe(1);
    expect(
      mocks.fetch.mock.calls.some(([input]) =>
        String(input).includes("/datasets/dbt_backup/tables"),
      ),
    ).toBe(false);
    expect(
      mocks.fetch.mock.calls.some(([input]) =>
        String(input).includes("/datasets/dbt_dev/tables"),
      ),
    ).toBe(false);
  });

  it.each([
    [{ dataset: "dbt_backup" }, "dbt_backup"],
    [{ table: "dbt_dev.signups" }, "dbt_dev"],
  ])(
    "rejects direct restricted metadata access by default",
    async (args, datasetId) => {
      await expect(action.run(args)).rejects.toMatchObject({
        code: "bigquery_restricted_schema",
        datasetId,
      });
    },
  );

  it("allows a specifically requested restricted dataset with the explicit marker", async () => {
    const tablesResult = await action.run({
      dataset: "dbt_backup",
      restrictedSchemaAccess: "user-explicit-request",
    });
    const tableResult = await action.run({
      table: "dbt_backup.archived_signups",
      restrictedSchemaAccess: "user-explicit-request",
    });

    expect(tablesResult).toMatchObject({
      mode: "tables",
      datasetId: "dbt_backup",
      tables: [{ tableId: "archived_signups" }],
    });
    expect(tableResult).toMatchObject({
      mode: "table",
      table: {
        datasetId: "dbt_backup",
        tableId: "archived_signups",
      },
    });
  });
});
