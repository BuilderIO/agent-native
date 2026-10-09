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

    expect(result.tables[0]).toEqual(
      expect.objectContaining({
        datasetId: "product",
        tableId: "product_user_dimension",
      }),
    );
    expect(result.tables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableId: "analytics_app_users" }),
      ]),
    );
  });

  it("continues global search without rescanning the previous metadata page", async () => {
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
        if (url.searchParams.get("pageToken") === "table-page-two") {
          return jsonResponse({
            tables: [
              {
                tableReference: {
                  projectId: "test-project",
                  datasetId: "product",
                  tableId: "user_events",
                },
              },
            ],
          });
        }
        return jsonResponse({
          tables: [
            {
              tableReference: {
                projectId: "test-project",
                datasetId: "product",
                tableId: "user_accounts",
              },
            },
          ],
          nextPageToken: "table-page-two",
        });
      }

      if (
        path.endsWith("/datasets/product/tables/user_accounts") ||
        path.endsWith("/datasets/product/tables/user_events")
      ) {
        const tableId = path.endsWith("/user_accounts")
          ? "user_accounts"
          : "user_events";
        return jsonResponse({
          tableReference: {
            projectId: "test-project",
            datasetId: "product",
            tableId,
          },
          schema: { fields: [{ name: "user_id", type: "STRING" }] },
        });
      }

      return jsonResponse({}, 404);
    });

    const firstPage = await action.run({ search: "user", limit: 1 });
    expect(firstPage).toMatchObject({
      tables: [expect.objectContaining({ tableId: "user_accounts" })],
      searched: 1,
      of: 1,
      truncated: true,
    });

    const secondPage = await action.run({
      search: "user",
      limit: 1,
      nextPage: firstPage.nextPage,
    });
    expect(secondPage).toMatchObject({
      tables: [expect.objectContaining({ tableId: "user_events" })],
      searched: 2,
      of: 2,
      truncated: false,
    });
    const tableListingCalls = mocks.fetch.mock.calls.filter(([input]) =>
      new URL(String(input)).pathname.endsWith("/datasets/product/tables"),
    );
    expect(
      tableListingCalls.map(([input]) =>
        new URL(String(input)).searchParams.get("pageToken"),
      ),
    ).toEqual([null, "table-page-two"]);
    const metadataCalls = mocks.fetch.mock.calls.filter(([input]) =>
      /\/datasets\/product\/tables\/user_(accounts|events)$/.test(
        new URL(String(input)).pathname,
      ),
    );
    expect(metadataCalls).toHaveLength(2);
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

  it("carries dataset table search counts across provider pages", async () => {
    mocks.fetch.mockImplementation(async (input: URL | string) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/datasets/product/tables")) {
        if (url.searchParams.get("pageToken") === "table-page-two") {
          return jsonResponse({
            tables: [
              {
                tableReference: {
                  projectId: "test-project",
                  datasetId: "product",
                  tableId: "product_user_dimension",
                },
              },
            ],
          });
        }
        return jsonResponse({
          tables: [
            {
              tableReference: {
                projectId: "test-project",
                datasetId: "product",
                tableId: "analytics_app_users",
              },
            },
          ],
          nextPageToken: "table-page-two",
        });
      }
      if (url.pathname.endsWith("/tables/analytics_app_users")) {
        return jsonResponse({
          tableReference: {
            projectId: "test-project",
            datasetId: "product",
            tableId: "analytics_app_users",
          },
          schema: { fields: [{ name: "user_id", type: "STRING" }] },
        });
      }
      if (url.pathname.endsWith("/tables/product_user_dimension")) {
        return jsonResponse({
          tableReference: {
            projectId: "test-project",
            datasetId: "product",
            tableId: "product_user_dimension",
          },
          schema: { fields: [{ name: "user_id", type: "STRING" }] },
        });
      }
      return jsonResponse({}, 404);
    });

    const first = await action.run({
      dataset: "product",
      search: "user",
      limit: 1,
    });
    expect(first).toMatchObject({ searched: 1, of: 1, truncated: true });
    expect(first.nextPage).toMatch(/^bq1\./);

    const second = await action.run({
      dataset: "product",
      search: "user",
      limit: 1,
      nextPage: first.nextPage,
    });
    expect(second).toMatchObject({ searched: 2, of: 2, truncated: false });
    expect(second.tables).toEqual([
      expect.objectContaining({ tableId: "product_user_dimension" }),
    ]);
    expect(
      mocks.fetch.mock.calls.some(([input]) => {
        const url = new URL(String(input));
        return (
          url.pathname.endsWith("/datasets/product/tables") &&
          url.searchParams.get("pageToken") === "table-page-two"
        );
      }),
    ).toBe(true);
  });

  it("follows dataset continuation pages during global search below the scan cap", async () => {
    const defaultFetch = mocks.fetch.getMockImplementation();
    mocks.fetch.mockImplementation(async (input: URL | string) => {
      const url = new URL(String(input));
      const path = url.pathname;

      if (path.endsWith("/datasets")) {
        if (url.searchParams.get("pageToken") === "next-dataset-page") {
          return jsonResponse({
            datasets: [
              {
                datasetReference: {
                  projectId: "test-project",
                  datasetId: "identity_data",
                },
              },
            ],
          });
        }
        return jsonResponse({
          datasets: [
            {
              datasetReference: {
                projectId: "test-project",
                datasetId: "product",
              },
            },
          ],
          nextPageToken: "next-dataset-page",
        });
      }

      if (path.endsWith("/datasets/identity_data/tables")) {
        return jsonResponse({
          tables: [
            {
              tableReference: {
                projectId: "test-project",
                datasetId: "identity_data",
                tableId: "builder_user_identity_map",
              },
              type: "TABLE",
            },
          ],
        });
      }

      if (
        path.endsWith(
          "/datasets/identity_data/tables/builder_user_identity_map",
        )
      ) {
        return jsonResponse({
          tableReference: {
            projectId: "test-project",
            datasetId: "identity_data",
            tableId: "builder_user_identity_map",
          },
          schema: { fields: [{ name: "user_id", type: "STRING" }] },
        });
      }

      return defaultFetch?.(input) ?? jsonResponse({}, 404);
    });

    const result = await action.run({ search: "identity", limit: 10 });

    expect(result).toMatchObject({
      datasetsScanned: 2,
      tablesScanned: 7,
      truncated: false,
      nextPage: null,
      tables: [
        expect.objectContaining({
          datasetId: "identity_data",
          tableId: "builder_user_identity_map",
        }),
      ],
    });
    expect(
      mocks.fetch.mock.calls.some(([input]) => {
        const url = new URL(String(input));
        return (
          url.pathname.endsWith("/datasets") &&
          url.searchParams.get("pageToken") === "next-dataset-page"
        );
      }),
    ).toBe(true);
  });

  it("follows table continuation pages during global search below the scan cap", async () => {
    const defaultFetch = mocks.fetch.getMockImplementation();
    mocks.fetch.mockImplementation(async (input: URL | string) => {
      const url = new URL(String(input));
      const path = url.pathname;

      if (path.endsWith("/datasets/product/tables")) {
        if (url.searchParams.get("pageToken") === "next-table-page") {
          return jsonResponse({
            tables: [
              {
                tableReference: {
                  projectId: "test-project",
                  datasetId: "product",
                  tableId: "system_identity_map",
                },
                type: "TABLE",
              },
            ],
          });
        }
        return jsonResponse({
          tables: [
            {
              tableReference: {
                projectId: "test-project",
                datasetId: "product",
                tableId: "generic_table",
              },
              type: "TABLE",
            },
          ],
          nextPageToken: "next-table-page",
        });
      }

      if (path.endsWith("/datasets/product/tables/generic_table")) {
        return jsonResponse({
          tableReference: {
            projectId: "test-project",
            datasetId: "product",
            tableId: "generic_table",
          },
          schema: { fields: [{ name: "id", type: "STRING" }] },
        });
      }

      if (path.endsWith("/datasets/product/tables/system_identity_map")) {
        return jsonResponse({
          tableReference: {
            projectId: "test-project",
            datasetId: "product",
            tableId: "system_identity_map",
          },
          schema: { fields: [{ name: "user_id", type: "STRING" }] },
        });
      }

      return defaultFetch?.(input) ?? jsonResponse({}, 404);
    });

    const result = await action.run({ search: "identity", limit: 10 });

    expect(result).toMatchObject({
      datasetsScanned: 1,
      tablesScanned: 2,
      truncated: false,
      nextPage: null,
      tables: [expect.objectContaining({ tableId: "system_identity_map" })],
    });
    expect(
      mocks.fetch.mock.calls.some(([input]) => {
        const url = new URL(String(input));
        return (
          url.pathname.endsWith("/datasets/product/tables") &&
          url.searchParams.get("pageToken") === "next-table-page"
        );
      }),
    ).toBe(true);
  });

  it("returns a resumable cursor when the global dataset scan reaches its cap", async () => {
    mocks.fetch.mockImplementation(async (input: URL | string) => {
      const url = new URL(String(input));
      const path = url.pathname;

      if (path.endsWith("/datasets")) {
        if (url.searchParams.get("pageToken") === "dataset-page-2") {
          return jsonResponse({
            datasets: [
              {
                datasetReference: {
                  projectId: "test-project",
                  datasetId: "dataset_100",
                },
              },
            ],
          });
        }
        return jsonResponse({
          datasets: Array.from({ length: 100 }, (_, index) => ({
            datasetReference: {
              projectId: "test-project",
              datasetId: `dataset_${String(index).padStart(3, "0")}`,
            },
          })),
          nextPageToken: "dataset-page-2",
        });
      }

      if (path.includes("/datasets/") && path.endsWith("/tables")) {
        return jsonResponse({ tables: [] });
      }

      return jsonResponse({}, 404);
    });

    const firstPage = await action.run({ search: "nothing", limit: 10 });
    expect(firstPage).toMatchObject({
      datasetsScanned: 100,
      tablesScanned: 0,
      truncated: true,
    });
    expect(firstPage.nextPage).toMatch(/^bqg2\./);

    const secondPage = await action.run({
      search: "nothing",
      limit: 10,
      nextPage: firstPage.nextPage,
    });
    expect(secondPage).toMatchObject({
      datasetsScanned: 101,
      tablesScanned: 0,
      searched: 0,
      of: 0,
      truncated: false,
      nextPage: null,
    });
  });
});
