import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  getCredentialContext: vi.fn(),
  resolveCredential: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: vi.fn() }),
}));
vi.mock("@agent-native/core/server", () => ({
  getCredentialContext: mocks.getCredentialContext,
  getRequestRunContext: () => undefined,
}));
vi.mock("../server/lib/credentials", () => ({
  resolveCredential: mocks.resolveCredential,
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
  mocks.getCredentialContext.mockReset();
  mocks.resolveCredential.mockReset();
  mocks.fetch.mockReset();
  mocks.getAccessToken.mockResolvedValue("test-token");
  mocks.getCredentialContext.mockReturnValue({
    userEmail: "test@example.com",
    orgId: null,
  });
  mocks.resolveCredential.mockImplementation(async (key: string) =>
    key === "BIGQUERY_PROJECT_ID" ? "test-project" : null,
  );
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
              tableId: "event_log",
            },
            type: "TABLE",
          },
          {
            tableReference: {
              projectId: "test-project",
              datasetId: "product",
              tableId: "credit_usage",
            },
            type: "TABLE",
          },
          {
            tableReference: {
              projectId: "test-project",
              datasetId: "product",
              tableId: "product_user_dimension",
            },
            type: "TABLE",
          },
          {
            tableReference: {
              projectId: "test-project",
              datasetId: "product",
              tableId: "analytics_app_users",
            },
            type: "TABLE",
          },
          {
            tableReference: {
              projectId: "test-project",
              datasetId: "product",
              tableId: "product_activation_funnel",
            },
            type: "TABLE",
          },
          {
            tableReference: {
              projectId: "test-project",
              datasetId: "product",
              tableId: "user_profiles",
            },
            type: "TABLE",
          },
        ],
      });
    }

    if (path.endsWith("/datasets/product/tables/event_log")) {
      return jsonResponse({
        tableReference: {
          projectId: "test-project",
          datasetId: "product",
          tableId: "event_log",
        },
        schema: {
          fields: [
            { name: "created_at", type: "TIMESTAMP" },
            { name: "created_by_user_id", type: "STRING" },
          ],
        },
      });
    }

    if (path.endsWith("/datasets/product/tables/credit_usage")) {
      return jsonResponse({
        tableReference: {
          projectId: "test-project",
          datasetId: "product",
          tableId: "credit_usage",
        },
        schema: {
          fields: [
            { name: "user_id", type: "STRING" },
            { name: "credits_consumed", type: "NUMERIC" },
          ],
        },
      });
    }

    if (path.endsWith("/datasets/product/tables/product_user_dimension")) {
      return jsonResponse({
        tableReference: {
          projectId: "test-project",
          datasetId: "product",
          tableId: "product_user_dimension",
        },
        schema: { fields: [{ name: "user_id", type: "STRING" }] },
      });
    }

    if (path.endsWith("/datasets/product/tables/analytics_app_users")) {
      return jsonResponse({
        tableReference: {
          projectId: "test-project",
          datasetId: "product",
          tableId: "analytics_app_users",
        },
        schema: { fields: [{ name: "user_id", type: "STRING" }] },
      });
    }

    if (path.endsWith("/datasets/product/tables/product_activation_funnel")) {
      return jsonResponse({
        tableReference: {
          projectId: "test-project",
          datasetId: "product",
          tableId: "product_activation_funnel",
        },
        schema: { fields: [{ name: "user_id", type: "STRING" }] },
      });
    }

    if (path.endsWith("/datasets/product/tables/user_profiles")) {
      return jsonResponse({
        tableReference: {
          projectId: "test-project",
          datasetId: "product",
          tableId: "user_profiles",
        },
        schema: { fields: [{ name: "user_id", type: "STRING" }] },
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
      tablesScanned: 6,
      truncated: false,
    });
    expect(result.tables).toEqual([
      expect.objectContaining({
        datasetId: "product",
        tableId: "credit_usage",
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
        tableId: "event_log",
        columns: expect.arrayContaining([
          expect.objectContaining({ name: "created_by_user_id" }),
        ]),
      }),
    ]);
  });

  it("distinguishes Builder product users from Analytics users and feature funnels", async () => {
    const result = await action.run({ search: "Builder.io users", limit: 10 });

    expect(result.tables).toEqual([
      expect.objectContaining({
        datasetId: "product",
        tableId: "product_user_dimension",
      }),
    ]);
  });

  it("pages through ranked matches with a query-bound cursor", async () => {
    const firstPage = await action.run({ search: "user", limit: 1 });
    expect(firstPage.nextPage).toBeTruthy();
    expect(firstPage.truncated).toBe(true);

    const secondPage = await action.run({
      search: "user",
      limit: 1,
      nextPage: firstPage.nextPage,
    });
    expect(secondPage.tables).toHaveLength(1);
    expect(secondPage.tables[0]?.tableId).not.toBe(
      firstPage.tables[0]?.tableId,
    );
    await expect(
      action.run({ search: "credit", limit: 1, nextPage: firstPage.nextPage }),
    ).rejects.toThrow(/does not match this query/);
  });

  it("keeps the no-argument call as a lightweight dataset listing", async () => {
    const result = await action.run({});

    expect(result).toMatchObject({
      mode: "datasets",
      datasets: [{ datasetId: "product" }],
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns a query-bound continuation for dataset pages", async () => {
    mocks.fetch.mockImplementationOnce(async () =>
      jsonResponse({
        datasets: [
          {
            datasetReference: {
              projectId: "test-project",
              datasetId: "product",
            },
          },
        ],
        totalItems: 2,
        nextPageToken: "dataset-next-page-token",
      }),
    );

    const result = await action.run({ limit: 1 });
    expect(result).toMatchObject({
      searched: 1,
      of: 2,
      truncated: true,
    });
    expect(result.nextPage).toMatch(/^bq1\./);
  });

  it("returns provider continuation metadata for exact dataset table listings", async () => {
    mocks.fetch.mockImplementationOnce(async () =>
      jsonResponse({
        tables: [
          {
            tableReference: {
              projectId: "test-project",
              datasetId: "product",
              tableId: "event_log",
            },
          },
        ],
        totalItems: 2,
        nextPageToken: "table-next-page-token",
      }),
    );

    const result = await action.run({ dataset: "product", limit: 1 });
    expect(result).toMatchObject({
      searched: 1,
      of: 2,
      truncated: true,
      tables: [{ tableId: "event_log" }],
    });
    expect(result.nextPage).toMatch(/^bq1\./);
  });
});
