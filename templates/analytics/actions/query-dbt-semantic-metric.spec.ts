import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listWorkspaceConnectionsForApp: vi.fn(),
  resolveWorkspaceConnectionCredentialForApp: vi.fn(),
  executeProviderApiRequest: vi.fn(),
  getRequestUserEmail: vi.fn(() => "eval-user@example.test"),
  getRequestOrgId: vi.fn(() => "org_eval"),
}));

vi.mock("@agent-native/core/action", () => ({
  AgentConnectionRequiredError: class extends Error {
    agentConnectionRequired = true;
    provider: string;
    reason: string;
    constructor(
      message: string,
      options: { provider: string; reason?: string },
    ) {
      super(message);
      this.provider = options.provider;
      this.reason = options.reason ?? "connect";
    }
  },
  defineAction: (config: unknown) => config,
  fail: (message: string, options?: { errorCode?: string }) => {
    throw Object.assign(new Error(message), options);
  },
  isAgentConnectionRequiredError: (error: unknown) =>
    Boolean(
      error &&
      typeof error === "object" &&
      "agentConnectionRequired" in error &&
      error.agentConnectionRequired === true,
    ),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/workspace-connections", () => ({
  listWorkspaceConnectionsForApp: mocks.listWorkspaceConnectionsForApp,
  resolveWorkspaceConnectionCredentialForApp:
    mocks.resolveWorkspaceConnectionCredentialForApp,
}));

vi.mock("../server/lib/provider-api", () => ({
  executeProviderApiRequest: mocks.executeProviderApiRequest,
}));

vi.mock("../server/lib/provider-credentials", () => ({
  ANALYTICS_APP_ID: "analytics",
}));

const { default: action } = await import("./query-dbt-semantic-metric");

const syntheticEvalRows = readFileSync(
  new URL(
    "../evals/dbt-semantic-layer/SYNTHETIC-dbt-semantic-metric.csv",
    import.meta.url,
  ),
  "utf8",
)
  .trim()
  .split("\n")
  .slice(1)
  .map((row) => row.split(","));
const metricByNameEval = syntheticEvalRows.find(
  (row) => row[1] === "metric-by-name",
)!;
const jobRunRefusedEval = syntheticEvalRows.find(
  (row) => row[1] === "job-run-refused",
)!;
const groupedMetricEval = syntheticEvalRows.find(
  (row) => row[1] === "grouped-metric-by-name",
)!;

const connection = {
  id: "dbt-workspace-connection",
  label: "Analytics dbt",
  status: "connected",
  config: {
    semanticLayerBaseUrl:
      "https://wg204.semantic-layer.us1.dbt.com/api/graphql",
    semanticLayerEnvironmentId: "123456",
  },
};

function providerResult(json: unknown, status = 200, ok = true) {
  return { response: { ok, status, json } };
}

function metricMetadataResult(
  name = "active_workspaces",
  dimensions: unknown[] = [],
) {
  return providerResult({
    data: {
      metricsPaginated: {
        items: [{ name, dimensions, queryableGranularities: ["DAY", "WEEK"] }],
        totalItems: 1,
        totalPages: 1,
      },
    },
  });
}

function providerRequestTimeoutError() {
  const cause = Object.assign(new Error("aborted"), { name: "AbortError" });
  return new Error(
    "Provider API request timed out after 3000ms: POST dbt Semantic Layer",
    { cause },
  );
}

describe("query-dbt-semantic-metric", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listWorkspaceConnectionsForApp.mockResolvedValue([connection]);
    mocks.resolveWorkspaceConnectionCredentialForApp.mockImplementation(
      async ({ key }: { key: string }) => ({
        available: true,
        status: "resolved",
        value: "fake-dbt-token-for-tests",
      }),
    );
  });

  it("queries the known synthetic metric by name with the caller's dbt connection", async () => {
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(
        providerResult({
          data: {
            metricsPaginated: {
              items: [
                {
                  name: "active_workspaces",
                  description: "Synthetic active workspace count",
                  type: "simple",
                  dimensions: [],
                  queryableGranularities: ["day"],
                },
              ],
              totalItems: 1,
              totalPages: 1,
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        providerResult({ data: { createQuery: { queryId: "fake_query_1" } } }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 1,
              jsonResult: JSON.stringify({
                columns: ["active_workspaces"],
                data: [[42]],
              }),
            },
          },
        }),
      );

    await expect(
      action.run({ metricName: metricByNameEval[3]!, limit: 20 }),
    ).resolves.toMatchObject({
      status: metricByNameEval[5],
      metric: {
        name: metricByNameEval[6],
        description: "Synthetic active workspace count",
      },
      rows: [[Number(metricByNameEval[7])]],
      rowCount: 1,
      truncated: false,
      queryId: "fake_query_1",
      source: "dbt-semantic-layer",
    });
    expect(
      mocks.resolveWorkspaceConnectionCredentialForApp,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "dbt",
        key: "DBT_SEMANTIC_LAYER_TOKEN",
        connectionId: connection.id,
        userEmail: "eval-user@example.test",
        orgId: "org_eval",
      }),
    );
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(3);
    expect(
      mocks.executeProviderApiRequest.mock.calls.every(
        ([request]) => request.body.variables.environmentId === "123456",
      ),
    ).toBe(true);
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "dbt",
        method: "POST",
        path: "/api/graphql",
        connectionId: connection.id,
        body: expect.objectContaining({
          variables: expect.objectContaining({ environmentId: "123456" }),
        }),
      }),
    );
  });

  it("groups an exact metric by returned dimensions and preserves its bounded time range across pages", async () => {
    const dimensions = [
      {
        name: "root_org_id",
        description: "Synthetic organization identifier",
        type: "CATEGORICAL",
        queryableGranularities: [],
      },
    ];
    const metricTimeRange = { startDate: "2026-07-01", endDate: "2026-07-31" };
    const groupBy = [
      { name: "metric_time", grain: "WEEK" },
      { name: "root_org_id" },
    ];
    const rows = Array.from({ length: 25 }, (_, index) => [
      `2026-07-${String(index + 1).padStart(2, "0")}`,
      `org-${index + 1}`,
      index + 1,
    ]);
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(
        metricMetadataResult("weekly_active_product_users", dimensions),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: { createQuery: { queryId: "fake_group_query" } },
        }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 1,
              jsonResult: JSON.stringify({ data: rows }),
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 1,
              jsonResult: JSON.stringify({ data: rows }),
            },
          },
        }),
      )
      .mockResolvedValue(
        providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 1,
              jsonResult: JSON.stringify({ data: rows }),
            },
          },
        }),
      );

    const first = (await action.run({
      metricName: "weekly_active_product_users",
      groupBy,
      timeRange: metricTimeRange,
      limit: 20,
    })) as any;

    expect(first).toMatchObject({
      status: "success",
      metric: {
        name: "weekly_active_product_users",
        dimensionsCount: 1,
        dimensionsTruncated: false,
        dimensions: [
          {
            name: "root_org_id",
            type: "CATEGORICAL",
            queryableGranularities: [],
          },
        ],
        queryableGranularities: ["DAY", "WEEK"],
      },
      querySpec: { groupBy, timeRange: metricTimeRange },
      rows: rows.slice(0, 20),
      rowCount: 20,
      truncated: true,
      queryId: "fake_group_query",
    });
    expect(action.outputSchema.parse(first)).toEqual(first);

    const createRequest = mocks.executeProviderApiRequest.mock.calls[1]?.[0];
    expect(createRequest?.body.variables).toMatchObject({
      environmentId: "123456",
      metricName: "weekly_active_product_users",
      groupBy,
      where: [
        {
          sql: "{{ TimeDimension('metric_time', 'day') }} >= '2026-07-01'",
        },
        {
          sql: "{{ TimeDimension('metric_time', 'day') }} <= '2026-07-31'",
        },
      ],
      queryRowCap: 1_000,
    });

    const second = (await action.run({
      metricName: "weekly_active_product_users",
      queryId: first.queryId,
      nextPage: first.nextPage,
      limit: 20,
    })) as any;
    expect(second).toMatchObject({
      status: "success",
      querySpec: { groupBy, timeRange: metricTimeRange },
      rows: rows.slice(20),
      rowCount: 5,
      truncated: false,
    });
    expect(second).not.toHaveProperty("metric");
    expect(action.outputSchema.parse(second)).toEqual(second);
    expect(
      mocks.executeProviderApiRequest.mock.calls[3]?.[0].body.query,
    ).toContain("query AnalyticsMetricResult");
  });

  it("returns the known synthetic grouped metric answer", async () => {
    const expectedValue = groupedMetricEval[7]!;
    const [metricTime, organizationId, value] = expectedValue.split("|");
    const groupBy = [
      { name: "metric_time", grain: "WEEK" as const },
      { name: "root_org_id" },
    ];
    const timeRange = { startDate: "2026-07-01", endDate: "2026-07-31" };
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(
        providerResult({
          data: {
            metricsPaginated: {
              items: [
                {
                  name: groupedMetricEval[3],
                  description: "Synthetic weekly product users by organization",
                  type: "simple",
                  dimensions: [
                    {
                      name: "root_org_id",
                      type: "CATEGORICAL",
                      queryableGranularities: [],
                    },
                  ],
                  queryableGranularities: ["DAY", "WEEK"],
                },
              ],
              totalItems: 1,
              totalPages: 1,
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: { createQuery: { queryId: "fake_grouped_answer" } },
        }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 1,
              jsonResult: JSON.stringify({
                data: [
                  {
                    metric_time__WEEK: metricTime,
                    root_org_id: organizationId,
                    [groupedMetricEval[3]!]: Number(value),
                  },
                ],
              }),
            },
          },
        }),
      );

    const result = await action.run({
      metricName: groupedMetricEval[3]!,
      groupBy,
      timeRange,
      limit: 20,
    });

    expect(result).toMatchObject({
      status: groupedMetricEval[5],
      metric: { name: groupedMetricEval[6] },
      querySpec: { groupBy, timeRange },
      rows: [
        {
          metric_time__WEEK: metricTime,
          root_org_id: organizationId,
          [groupedMetricEval[3]!]: Number(value),
        },
      ],
      rowCount: 1,
      truncated: false,
    });
    expect(action.outputSchema.parse(result)).toEqual(result);
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(
      Number(groupedMetricEval[8]),
    );
  });

  it("refuses unknown dimensions and unsupported grains before creating a query", async () => {
    mocks.executeProviderApiRequest.mockResolvedValueOnce(
      providerResult({
        data: {
          metricsPaginated: {
            items: [
              {
                name: "weekly_active_product_users",
                dimensions: [
                  {
                    name: "event_date",
                    type: "TIME",
                    queryableGranularities: ["DAY"],
                  },
                ],
                queryableGranularities: ["DAY", "WEEK"],
              },
            ],
            totalItems: 1,
            totalPages: 1,
          },
        },
      }),
    );

    await expect(
      action.run({
        metricName: "weekly_active_product_users",
        groupBy: [{ name: "unknown_org_id" }],
        timeRange: { startDate: "2026-07-01", endDate: "2026-07-31" },
        limit: 20,
      }),
    ).rejects.toMatchObject({ errorCode: "dbt_metric_dimension_invalid" });
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(1);

    mocks.executeProviderApiRequest.mockReset();
    mocks.executeProviderApiRequest.mockResolvedValueOnce(
      providerResult({
        data: {
          metricsPaginated: {
            items: [
              {
                name: "weekly_active_product_users",
                dimensions: [
                  {
                    name: "event_date",
                    type: "TIME",
                    queryableGranularities: ["DAY"],
                  },
                ],
                queryableGranularities: ["DAY", "WEEK"],
              },
            ],
            totalItems: 1,
            totalPages: 1,
          },
        },
      }),
    );

    await expect(
      action.run({
        metricName: "weekly_active_product_users",
        groupBy: [{ name: "event_date", grain: "WEEK" }],
        timeRange: { startDate: "2026-07-01", endDate: "2026-07-31" },
        limit: 20,
      }),
    ).rejects.toMatchObject({ errorCode: "dbt_metric_grain_unsupported" });
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(1);
  });

  it("validates date bounds, duplicate dimensions, and continuations at the action boundary", () => {
    for (const timeRange of [
      { startDate: "2026-02-30", endDate: "2026-03-01" },
      { startDate: "2025-01-01", endDate: "2026-01-02" },
      { startDate: "2026-07-31", endDate: "2026-07-01" },
    ]) {
      expect(
        action.schema.safeParse({
          metricName: "weekly_active_product_users",
          timeRange,
        }).success,
      ).toBe(false);
    }
    expect(
      action.schema.safeParse({
        metricName: "weekly_active_product_users",
        groupBy: [{ name: "root_org_id" }],
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        metricName: "weekly_active_product_users",
        groupBy: [{ name: "root_org_id" }, { name: "root_org_id" }],
        timeRange: { startDate: "2026-07-01", endDate: "2026-07-31" },
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        metricName: "weekly_active_product_users",
        queryId: "fake_group_query",
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        metricName: "weekly_active_product_users",
        queryId: "fake_group_query",
        nextPage: "metric-results-v3.eyJ0ZXN0IjoidHJ1ZSJ9",
        groupBy: [{ name: "root_org_id" }],
        timeRange: { startDate: "2026-07-01", endDate: "2026-07-31" },
      }).success,
    ).toBe(false);
    for (const nextPage of [
      "metric-results-v2.eyJ0ZXN0IjoidHJ1ZSJ9",
      "metric-results-v3.eyJ0ZXN0IjoidHJ1ZSJ9",
    ]) {
      expect(
        action.schema.safeParse({
          metricName: "weekly_active_product_users",
          queryId: "fake_group_query",
          nextPage,
        }).success,
      ).toBe(false);
    }
  });

  it("reports truncated metric dimensions and granularity metadata", async () => {
    const dimensions = Array.from({ length: 31 }, (_, index) => ({
      name: `synthetic_dimension_${index + 1}`,
      type: "CATEGORICAL",
      queryableGranularities: [],
    }));
    const granularities = [
      "DAY",
      "WEEK",
      "MONTH",
      "QUARTER",
      "YEAR",
      "HOUR",
      "MINUTE",
      "SECOND",
      "DECADE",
      "CENTURY",
      "MILLENNIUM",
    ];
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(
        providerResult({
          data: {
            metricsPaginated: {
              items: [
                {
                  name: "synthetic_metric",
                  dimensions,
                  queryableGranularities: granularities,
                },
              ],
              totalItems: 1,
              totalPages: 1,
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        providerResult({ data: { createQuery: { queryId: "fake_query_1" } } }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 1,
              jsonResult: JSON.stringify({ data: [[42]] }),
            },
          },
        }),
      );

    await expect(
      action.run({ metricName: "synthetic_metric", limit: 20 }),
    ).resolves.toMatchObject({
      status: "success",
      metric: {
        dimensionsCount: 31,
        dimensionsTruncated: true,
        dimensions: expect.arrayContaining([
          {
            name: "synthetic_dimension_1",
            type: "CATEGORICAL",
            queryableGranularities: [],
          },
        ]),
        queryableGranularities: granularities.slice(0, 10),
        queryableGranularitiesCount: 11,
        queryableGranularitiesTruncated: true,
      },
    });
  });

  it("returns a clear deployment state when the environment has no successful run", async () => {
    mocks.executeProviderApiRequest.mockResolvedValueOnce(
      providerResult({
        errors: [{ message: "Environment needs a successful dbt run" }],
      }),
    );

    await expect(
      action.run({ metricName: "active_workspaces", limit: 20 }),
    ).resolves.toMatchObject({
      status: "deployment_not_ready",
      message: "Environment needs a successful dbt run",
    });
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(1);
  });

  it("requires an environment ID on the selected workspace connection", async () => {
    mocks.listWorkspaceConnectionsForApp.mockResolvedValueOnce([
      {
        ...connection,
        config: {
          semanticLayerBaseUrl: connection.config.semanticLayerBaseUrl,
        },
      },
    ]);

    await expect(
      action.run({ metricName: "active_workspaces", limit: 20 }),
    ).resolves.toMatchObject({
      status: "connection_error",
      connection: { id: connection.id },
      message: expect.stringContaining("Set the dbt environment ID"),
    });
    expect(
      mocks.resolveWorkspaceConnectionCredentialForApp,
    ).not.toHaveBeenCalled();
    expect(mocks.executeProviderApiRequest).not.toHaveBeenCalled();
  });

  it("returns a clear empty state for dbt's empty semantic manifest response", async () => {
    mocks.executeProviderApiRequest.mockResolvedValueOnce(
      providerResult({ errors: [{ message: "Empty semantic manifest" }] }),
    );

    await expect(
      action.run({ metricName: "active_workspaces", limit: 20 }),
    ).resolves.toMatchObject({
      status: "empty_semantic_manifest",
      metricName: "active_workspaces",
      message: "This dbt environment has no semantic models or metrics yet.",
    });
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(1);
  });

  it("reports no metrics without claiming the semantic manifest is empty", async () => {
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(
        providerResult({
          data: {
            metricsPaginated: { items: [], totalItems: 0, totalPages: 0 },
          },
        }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: { metricsPaginated: { totalItems: 0 } },
        }),
      );

    await expect(
      action.run({ metricName: "active_workspaces", limit: 20 }),
    ).resolves.toMatchObject({
      status: "no_metrics_available",
      message:
        "This dbt environment has no metrics available. Semantic models may still exist without metrics.",
    });
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(2);
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/api/graphql",
        body: expect.objectContaining({
          query: expect.stringContaining("search: $search"),
          variables: expect.objectContaining({ search: "active_workspaces" }),
        }),
      }),
    );
    expect(mocks.executeProviderApiRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/api/graphql",
        body: {
          query: expect.stringContaining("pageSize: 1"),
          variables: { environmentId: "123456" },
        },
      }),
    );
  });

  it("reports not-found when an unfiltered count confirms the manifest is nonempty", async () => {
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(
        providerResult({
          data: {
            metricsPaginated: { items: [], totalItems: 0, totalPages: 0 },
          },
        }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: { metricsPaginated: { totalItems: 8 } },
        }),
      );

    await expect(
      action.run({ metricName: "active_workspaces", limit: 20 }),
    ).resolves.toMatchObject({
      status: "not_found",
      metricName: "active_workspaces",
      searched: 0,
      of: 0,
    });
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(2);
    expect(mocks.executeProviderApiRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          query: expect.stringContaining("pageSize: 1"),
          variables: { environmentId: "123456" },
        }),
      }),
    );
  });

  it("preserves the exact safe dbt permission error as a typed result", async () => {
    mocks.executeProviderApiRequest.mockResolvedValueOnce(
      providerResult(
        { errors: [{ message: "Missing Metadata Only permission" }] },
        403,
        false,
      ),
    );

    await expect(
      action.run({ metricName: "active_workspaces", limit: 20 }),
    ).resolves.toMatchObject({
      status: "permission_denied",
      message: "Missing Metadata Only permission",
    });
  });

  it("classifies a permission error returned in a successful GraphQL response", async () => {
    mocks.executeProviderApiRequest.mockResolvedValueOnce(
      providerResult({
        errors: [{ message: "Missing Metadata Only permission" }],
      }),
    );

    await expect(
      action.run({ metricName: "active_workspaces", limit: 20 }),
    ).resolves.toMatchObject({
      status: "permission_denied",
      message: "Missing Metadata Only permission",
    });
  });

  it("throws a dbt connection-required error when the token is missing", async () => {
    mocks.resolveWorkspaceConnectionCredentialForApp.mockImplementation(
      async () => ({ available: false, status: "missing_secret" }),
    );

    await expect(
      action.run({ metricName: "active_workspaces", limit: 20 }),
    ).rejects.toMatchObject({
      agentConnectionRequired: true,
      provider: "dbt",
      reason: "connect",
    });
    expect(mocks.executeProviderApiRequest).not.toHaveBeenCalled();
  });

  it("asks the user to reauthorize a dbt connection that needs reauth", async () => {
    mocks.listWorkspaceConnectionsForApp.mockResolvedValueOnce([
      { ...connection, status: "needs_reauth" },
    ]);

    await expect(
      action.run({ metricName: "active_workspaces", limit: 20 }),
    ).rejects.toMatchObject({
      agentConnectionRequired: true,
      provider: "dbt",
      reason: "reauthorize",
    });
    expect(
      mocks.resolveWorkspaceConnectionCredentialForApp,
    ).not.toHaveBeenCalled();
    expect(mocks.executeProviderApiRequest).not.toHaveBeenCalled();
  });

  it("returns a distinct error state for a dbt connection error", async () => {
    mocks.listWorkspaceConnectionsForApp.mockResolvedValueOnce([
      { ...connection, status: "error" },
    ]);

    await expect(
      action.run({ metricName: "active_workspaces", limit: 20 }),
    ).resolves.toMatchObject({
      status: "connection_error",
      connection: { id: connection.id, label: connection.label },
    });
    expect(
      mocks.resolveWorkspaceConnectionCredentialForApp,
    ).not.toHaveBeenCalled();
    expect(mocks.executeProviderApiRequest).not.toHaveBeenCalled();
  });

  it("returns a distinct error state when the dbt token cannot be read", async () => {
    mocks.resolveWorkspaceConnectionCredentialForApp.mockResolvedValueOnce({
      available: false,
      status: "error",
    });

    await expect(
      action.run({ metricName: "active_workspaces", limit: 20 }),
    ).resolves.toMatchObject({
      status: "connection_error",
      connection: { id: connection.id },
      message: expect.stringContaining("token could not be read"),
    });
    expect(mocks.executeProviderApiRequest).not.toHaveBeenCalled();
  });

  it("returns a distinct error state when the dbt endpoint is unavailable", async () => {
    mocks.executeProviderApiRequest.mockResolvedValueOnce(
      providerResult(
        { errors: [{ message: "Service unavailable" }] },
        503,
        false,
      ),
    );

    await expect(
      action.run({ metricName: "active_workspaces", limit: 20 }),
    ).resolves.toMatchObject({
      status: "connection_error",
      connection: { id: connection.id },
      message: "The dbt Semantic Layer request failed with HTTP 503.",
    });
  });

  it("paginates bounded metric results without losing rows or environment context", async () => {
    const firstPageRows = Array.from({ length: 25 }, (_, index) => [index + 1]);
    const secondPageRows = [[26], [27], [28]];
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(
        providerResult({
          data: {
            metricsPaginated: {
              items: [{ name: "active_workspaces", dimensions: [] }],
              totalItems: 1,
              totalPages: 1,
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        providerResult({ data: { createQuery: { queryId: "fake_query_1" } } }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 2,
              jsonResult: JSON.stringify({ data: firstPageRows }),
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 2,
              jsonResult: JSON.stringify({ data: firstPageRows }),
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 2,
              jsonResult: JSON.stringify({ data: secondPageRows }),
            },
          },
        }),
      );

    const first = (await action.run({
      metricName: "active_workspaces",
      limit: 20,
    })) as any;
    expect(first).toMatchObject({
      status: "success",
      rows: firstPageRows.slice(0, 20),
      rowCount: 20,
      truncated: true,
    });
    expect(typeof first.nextPage).toBe("string");

    const second = (await action.run({
      metricName: "active_workspaces",
      queryId: first.queryId,
      nextPage: first.nextPage,
      limit: 20,
    })) as any;
    expect(second).toMatchObject({
      status: "success",
      rows: firstPageRows.slice(20),
      rowCount: 5,
      truncated: true,
    });
    expect(typeof second.nextPage).toBe("string");

    const third = await action.run({
      metricName: "active_workspaces",
      queryId: first.queryId,
      nextPage: second.nextPage,
      limit: 20,
    });
    expect(third).toMatchObject({
      status: "success",
      rows: secondPageRows,
      rowCount: 3,
      truncated: false,
    });

    const requests = mocks.executeProviderApiRequest.mock.calls.map(
      ([request]) => request,
    );
    expect(
      requests.every(
        (request: any) => request.body.variables.environmentId === "123456",
      ),
    ).toBe(true);
    expect(requests[2]?.body.variables.pageNum).toBe(1);
    expect(requests[3]?.body.variables.pageNum).toBe(1);
    expect(requests[4]?.body.variables.pageNum).toBe(2);
    expect(requests[1]?.body.variables.queryRowCap).toBe(1_000);
    expect(requests[1]?.body.variables.limit).toBeUndefined();
  });

  it.each(["querySpec", "signature"] as const)(
    "rejects a metric result cursor with a tampered %s",
    async (tamper) => {
      const rows = Array.from({ length: 25 }, (_, index) => [index + 1]);
      mocks.executeProviderApiRequest
        .mockResolvedValueOnce(metricMetadataResult())
        .mockResolvedValueOnce(
          providerResult({
            data: { createQuery: { queryId: "fake_query_1" } },
          }),
        )
        .mockResolvedValueOnce(
          providerResult({
            data: {
              query: {
                status: "SUCCESSFUL",
                totalPages: 1,
                jsonResult: JSON.stringify({ data: rows }),
              },
            },
          }),
        );

      const first = (await action.run({
        metricName: "active_workspaces",
        limit: 20,
      })) as any;
      const cursorValue = String(first.nextPage);
      const signedPayload = cursorValue.slice("metric-results-v4.".length);
      const signatureSeparator = signedPayload.lastIndexOf(".");
      const payload = signedPayload.slice(0, signatureSeparator);
      const signature = signedPayload.slice(signatureSeparator + 1);
      const parsedPayload = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      );
      const tamperedPayload =
        tamper === "querySpec"
          ? {
              ...parsedPayload,
              querySpec: {
                groupBy: [{ name: "root_org_id" }],
                timeRange: {
                  startDate: "2026-07-01",
                  endDate: "2026-07-31",
                },
              },
            }
          : parsedPayload;
      const encodedTamperedPayload = Buffer.from(
        JSON.stringify(tamperedPayload),
      ).toString("base64url");
      const tamperedSignature =
        tamper === "signature"
          ? `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`
          : signature;

      await expect(
        action.run({
          metricName: "active_workspaces",
          queryId: first.queryId,
          nextPage: `metric-results-v4.${encodedTamperedPayload}.${tamperedSignature}`,
          limit: 20,
        }),
      ).rejects.toMatchObject({
        errorCode: "invalid_metric_result_cursor",
      });
      expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(3);
    },
  );

  it("pages within a separately capped query and flags the total row cap", async () => {
    const cappedRows = Array.from({ length: 1_000 }, (_, index) => [index + 1]);
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(
        providerResult({
          data: {
            metricsPaginated: {
              items: [{ name: "active_workspaces", dimensions: [] }],
              totalItems: 1,
              totalPages: 1,
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        providerResult({ data: { createQuery: { queryId: "fake_query_1" } } }),
      )
      .mockImplementation(async (request: { body: { query: string } }) =>
        request.body.query.includes("AnalyticsMetricLookup")
          ? metricMetadataResult()
          : providerResult({
              data: {
                query: {
                  status: "SUCCESSFUL",
                  totalPages: 1,
                  jsonResult: JSON.stringify({ data: cappedRows }),
                },
              },
            }),
      );

    const receivedRows: unknown[] = [];
    let result = (await action.run({
      metricName: "active_workspaces",
      limit: 100,
    })) as any;
    for (;;) {
      receivedRows.push(...result.rows);
      if (!result.nextPage) break;
      result = (await action.run({
        metricName: "active_workspaces",
        queryId: result.queryId,
        nextPage: result.nextPage,
        limit: 100,
      })) as any;
    }

    expect(receivedRows).toHaveLength(1_000);
    expect(result).toMatchObject({
      status: "success",
      rowCount: 100,
      truncated: true,
      truncationReason: "query_row_cap",
    });
    expect(result).not.toHaveProperty("nextPage");
    expect(
      mocks.executeProviderApiRequest.mock.calls[1]?.[0].body.variables,
    ).toMatchObject({
      queryRowCap: 1_000,
    });
  });

  it.each([
    { label: "missing", totalPages: undefined },
    { label: "non-integer", totalPages: 1.5 },
    { label: "below the current page", totalPages: 0 },
  ])(
    "returns incomplete_result for $label totalPages",
    async ({ totalPages }) => {
      const query: Record<string, unknown> = {
        status: "SUCCESSFUL",
        jsonResult: JSON.stringify({ data: [[42]] }),
      };
      if (totalPages !== undefined) query.totalPages = totalPages;
      mocks.executeProviderApiRequest
        .mockResolvedValueOnce(
          providerResult({
            data: {
              metricsPaginated: {
                items: [{ name: "active_workspaces", dimensions: [] }],
                totalItems: 1,
                totalPages: 1,
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          providerResult({
            data: { createQuery: { queryId: "fake_query_1" } },
          }),
        )
        .mockResolvedValueOnce(providerResult({ data: { query } }));

      const result = await action.run({
        metricName: "active_workspaces",
        limit: 20,
      });

      expect(result).toMatchObject({
        status: "incomplete_result",
        queryId: "fake_query_1",
        message: expect.stringContaining("result completeness is unknown"),
      });
      expect(action.outputSchema.parse(result)).toEqual(result);
    },
  );

  it("keeps a timed-out poll pending with its query ID and result cursor", async () => {
    const firstPageRows = Array.from({ length: 25 }, (_, index) => [index + 1]);
    const alternateConnection = {
      ...connection,
      id: "other-dbt-workspace-connection",
      label: "Other dbt workspace",
    };
    mocks.listWorkspaceConnectionsForApp
      .mockResolvedValueOnce([connection, alternateConnection])
      .mockResolvedValueOnce([connection, alternateConnection]);
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(
        providerResult({
          data: {
            metricsPaginated: {
              items: [{ name: "active_workspaces", dimensions: [] }],
              totalItems: 1,
              totalPages: 1,
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        providerResult({ data: { createQuery: { queryId: "fake_query_1" } } }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 1,
              jsonResult: JSON.stringify({ data: firstPageRows }),
            },
          },
        }),
      )
      .mockRejectedValueOnce(providerRequestTimeoutError());

    const first = (await action.run({
      metricName: "active_workspaces",
      connectionId: connection.id,
      limit: 20,
    })) as any;
    const pending = await action.run({
      metricName: "active_workspaces",
      queryId: first.queryId,
      nextPage: first.nextPage,
      limit: 20,
    });

    expect(pending).toMatchObject({
      status: "pending",
      queryId: first.queryId,
      nextPage: first.nextPage,
      connection: { id: connection.id },
      source: "dbt-semantic-layer",
    });
    expect(
      mocks.resolveWorkspaceConnectionCredentialForApp,
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ connectionId: connection.id }),
    );
    expect(action.outputSchema.parse(pending)).toEqual(pending);
  });

  it("resumes polling after a provider error returns a result cursor", async () => {
    const rows = [{ active_workspaces: 42 }];
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(metricMetadataResult())
      .mockResolvedValueOnce(
        providerResult({ data: { createQuery: { queryId: "fake_query_1" } } }),
      )
      .mockResolvedValueOnce(
        providerResult({
          errors: [{ message: "MetricFlow could not complete the request" }],
        }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 1,
              jsonResult: JSON.stringify({ data: rows }),
            },
          },
        }),
      );

    const interrupted = await action.run({
      metricName: "active_workspaces",
      limit: 20,
    });

    expect(interrupted).toMatchObject({
      status: "provider_error",
      queryId: "fake_query_1",
      querySpec: { groupBy: [] },
      message: expect.stringContaining("Retry with the same metricName"),
    });
    expect((interrupted as any).nextPage).toMatch(/^metric-results-v4\./);
    expect(action.outputSchema.parse(interrupted)).toEqual(interrupted);

    const resumed = await action.run({
      metricName: "active_workspaces",
      queryId: (interrupted as any).queryId,
      nextPage: (interrupted as any).nextPage,
      limit: 20,
    });

    expect(resumed).toMatchObject({
      status: "success",
      queryId: "fake_query_1",
      querySpec: { groupBy: [] },
      rows,
      rowCount: 1,
      truncated: false,
    });
    expect(resumed).not.toHaveProperty("metric");
    expect(action.outputSchema.parse(resumed)).toEqual(resumed);
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(4);
    expect(
      mocks.executeProviderApiRequest.mock.calls[3]?.[0].body.query,
    ).toContain("query AnalyticsMetricResult");
  });

  it.each([
    [
      "invalid JSON result",
      {
        data: {
          query: {
            status: "SUCCESSFUL",
            totalPages: 1,
            jsonResult: "{not-json",
          },
        },
      },
    ],
    ["missing result data", { data: {} }],
    ["missing query status", { data: { query: null } }],
    [
      "unsupported query status",
      { data: { query: { status: "UNKNOWN_STATUS" } } },
    ],
  ])("preserves a result cursor after %s", async (_label, interruptedPoll) => {
    const rows = [{ active_workspaces: 42 }];
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(metricMetadataResult())
      .mockResolvedValueOnce(
        providerResult({ data: { createQuery: { queryId: "fake_query_1" } } }),
      )
      .mockResolvedValueOnce(providerResult(interruptedPoll))
      .mockResolvedValueOnce(
        providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 1,
              jsonResult: JSON.stringify({ data: rows }),
            },
          },
        }),
      );

    const interrupted = (await action.run({
      metricName: "active_workspaces",
      limit: 20,
    })) as any;

    expect(interrupted).toMatchObject({
      status: "provider_error",
      queryId: "fake_query_1",
      querySpec: { groupBy: [] },
      connection: { id: connection.id },
    });
    expect(interrupted.nextPage).toMatch(/^metric-results-v4\./);
    expect(action.outputSchema.parse(interrupted)).toEqual(interrupted);

    const resumed = await action.run({
      metricName: "active_workspaces",
      queryId: interrupted.queryId,
      nextPage: interrupted.nextPage,
      limit: 20,
    });

    expect(resumed).toMatchObject({
      status: "success",
      queryId: "fake_query_1",
      rows,
      rowCount: 1,
    });
    expect(action.outputSchema.parse(resumed)).toEqual(resumed);
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(4);
    expect(
      mocks.executeProviderApiRequest.mock.calls[3]?.[0].body.query,
    ).toContain("query AnalyticsMetricResult");
  });

  it("does not return an orphaned query ID for terminal failed queries", async () => {
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(metricMetadataResult())
      .mockResolvedValueOnce(
        providerResult({ data: { createQuery: { queryId: "fake_query_1" } } }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: {
            query: {
              status: "FAILED",
              error: "MetricFlow could not calculate the requested query",
            },
          },
        }),
      );

    const failed = await action.run({
      metricName: "active_workspaces",
      limit: 20,
    });

    expect(failed).toMatchObject({
      status: "provider_error",
      metricName: "active_workspaces",
      message: "MetricFlow could not calculate the requested query",
    });
    expect(failed).not.toHaveProperty("queryId");
    expect(failed).not.toHaveProperty("nextPage");
    expect(action.outputSchema.parse(failed)).toEqual(failed);
  });

  it("does not turn an out-of-range result cursor into a successful empty page", async () => {
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(metricMetadataResult())
      .mockResolvedValueOnce(
        providerResult({ data: { createQuery: { queryId: "fake_query_1" } } }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 1,
              jsonResult: JSON.stringify({
                data: Array.from({ length: 25 }, (_, index) => ({
                  value: index,
                })),
              }),
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 1,
              jsonResult: JSON.stringify({ data: [{ value: 20 }] }),
            },
          },
        }),
      );

    const first = (await action.run({
      metricName: "active_workspaces",
      limit: 20,
    })) as any;
    expect(first).toMatchObject({ status: "success", rowCount: 20 });
    expect(first.nextPage).toMatch(/^metric-results-v4\./);

    const invalidPage = await action.run({
      metricName: "active_workspaces",
      queryId: first.queryId,
      nextPage: first.nextPage,
      limit: 20,
    });

    expect(invalidPage).toMatchObject({
      status: "provider_error",
      queryId: first.queryId,
      nextPage: first.nextPage,
      querySpec: first.querySpec,
    });
    expect(action.outputSchema.parse(invalidPage)).toEqual(invalidPage);
  });

  it("does not resume a metric cursor from a connection outside the caller's app scope", async () => {
    const alternateConnection = {
      ...connection,
      id: "other-dbt-workspace-connection",
      label: "Other dbt workspace",
    };
    mocks.listWorkspaceConnectionsForApp
      .mockResolvedValueOnce([connection])
      .mockResolvedValueOnce([alternateConnection]);
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(metricMetadataResult())
      .mockResolvedValueOnce(
        providerResult({ data: { createQuery: { queryId: "fake_query_1" } } }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 1,
              jsonResult: JSON.stringify({
                data: Array.from({ length: 25 }, (_, index) => [index + 1]),
              }),
            },
          },
        }),
      );

    const first = (await action.run({
      metricName: "active_workspaces",
      limit: 20,
    })) as any;

    await expect(
      action.run({
        metricName: "active_workspaces",
        queryId: first.queryId,
        nextPage: first.nextPage,
        limit: 20,
      }),
    ).rejects.toMatchObject({
      agentConnectionRequired: true,
      provider: "dbt",
    });
    expect(
      mocks.resolveWorkspaceConnectionCredentialForApp,
    ).toHaveBeenCalledTimes(1);
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(3);
  });

  it("returns a connection error for a provider timeout before query creation", async () => {
    mocks.executeProviderApiRequest.mockRejectedValueOnce(
      providerRequestTimeoutError(),
    );

    const result = await action.run({
      metricName: "active_workspaces",
      limit: 20,
    });

    expect(result).toMatchObject({ status: "connection_error" });
    expect(result).not.toHaveProperty("queryId");
    expect(action.outputSchema.parse(result)).toEqual(result);
  });

  it("keeps an HTTP 504 during a resumable poll pending", async () => {
    const rows = Array.from({ length: 25 }, (_, index) => [index + 1]);
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(metricMetadataResult())
      .mockResolvedValueOnce(
        providerResult({ data: { createQuery: { queryId: "fake_query_1" } } }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 1,
              jsonResult: JSON.stringify({ data: rows }),
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        providerResult(
          { errors: [{ message: "Gateway timeout" }] },
          504,
          false,
        ),
      );

    const first = (await action.run({
      metricName: "active_workspaces",
      limit: 20,
    })) as any;
    const result = await action.run({
      metricName: "active_workspaces",
      queryId: first.queryId,
      nextPage: first.nextPage,
      limit: 20,
    });

    expect(result).toMatchObject({
      status: "pending",
      queryId: first.queryId,
      nextPage: first.nextPage,
      message: expect.stringContaining("HTTP 504"),
    });
    expect(action.outputSchema.parse(result)).toEqual(result);
  });

  it("does not return pending without a query ID when the action deadline aborts metadata lookup", async () => {
    vi.useFakeTimers();
    try {
      mocks.executeProviderApiRequest.mockImplementationOnce(async () => {
        await vi.advanceTimersByTimeAsync(12_000);
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      });

      const result = await action.run({
        metricName: "active_workspaces",
        limit: 20,
      });

      expect(result).toMatchObject({ status: "connection_error" });
      expect(result).not.toHaveProperty("queryId");
      expect(action.outputSchema.parse(result)).toEqual(result);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses the synthetic dbt job-run request before any provider call", () => {
    const parsed = action.schema.safeParse({
      metricName: jobRunRefusedEval[3],
      operation: jobRunRefusedEval[4],
    });

    expect(parsed.success).toBe(false);
    expect(mocks.executeProviderApiRequest.mock.calls.length).toBe(
      Number(jobRunRefusedEval[8]),
    );
  });

  it("does not report not-found when the exact-name search is truncated", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ body }: any) => {
        const pageNum = body.variables.pageNum;
        return providerResult({
          data: {
            metricsPaginated: {
              items: Array.from({ length: 100 }, (_, index) => ({
                name: `other_metric_${pageNum}_${index}`,
              })),
              totalItems: 1_500,
              totalPages: 15,
              pageNum,
            },
          },
        });
      },
    );

    await expect(
      action.run({ metricName: "missing_metric", limit: 20 }),
    ).resolves.toMatchObject({
      status: "metadata_truncated",
      searched: 1_000,
      of: 1_500,
      truncated: true,
      nextPage: "metric-metadata:11",
    });
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(10);
  });
});
