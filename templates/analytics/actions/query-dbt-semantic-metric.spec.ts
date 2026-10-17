import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listWorkspaceConnectionsForApp: vi.fn(),
  resolveWorkspaceConnectionCredentialForApp: vi.fn(),
  executeProviderApiRequest: vi.fn(),
  getRequestUserEmail: vi.fn(() => "eval-user@example.test"),
  getRequestOrgId: vi.fn(() => "org_eval"),
  hasAppSecret: vi.fn(async () => true),
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
  resolveWorkspaceConnectionsForApp: mocks.listWorkspaceConnectionsForApp,
  resolveWorkspaceConnectionCredentialForApp:
    mocks.resolveWorkspaceConnectionCredentialForApp,
}));

vi.mock("../server/lib/provider-api", () => ({
  executeProviderApiRequest: mocks.executeProviderApiRequest,
}));

vi.mock("../server/lib/provider-credentials", () => ({
  ANALYTICS_APP_ID: "analytics",
}));

vi.mock("@agent-native/core/secrets", () => ({
  hasAppSecret: mocks.hasAppSecret,
}));

const { default: action } = await import("./query-dbt-semantic-metric");

const runAction = (args: any) =>
  action.run({
    ...(!args.queryId &&
    !args.timeRange &&
    args.allTime === undefined &&
    !args.groupBy?.length
      ? { allTime: true }
      : {}),
    ...args,
  });

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
  credentialRefs: [
    { key: "DBT_SEMANTIC_LAYER_TOKEN", scope: "org", provider: "dbt" },
  ],
};

function providerResult(
  json: unknown,
  status = 200,
  ok = true,
  truncated = false,
) {
  return { response: { ok, status, json, truncated } };
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
      runAction({ metricName: metricByNameEval[3]!, limit: 20 }),
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
      querySpec: { groupBy: [], allTime: true },
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

  it("applies and returns an explicit bounded scope for a scalar metric query", async () => {
    const timeRange = { startDate: "2026-07-01", endDate: "2026-07-31" };
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(metricMetadataResult())
      .mockResolvedValueOnce(
        providerResult({
          data: { createQuery: { queryId: "fake_bounded_query" } },
        }),
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

    const result = await runAction({
      metricName: "active_workspaces",
      timeRange,
      limit: 20,
    });

    expect(result).toMatchObject({
      status: "success",
      querySpec: { groupBy: [], timeRange },
    });
    expect(
      mocks.executeProviderApiRequest.mock.calls[1]?.[0].body.variables.where,
    ).toEqual([
      { sql: "{{ TimeDimension('metric_time', 'day') }} >= '2026-07-01'" },
      { sql: "{{ TimeDimension('metric_time', 'day') }} <= '2026-07-31'" },
    ]);
    expect(action.outputSchema.parse(result)).toEqual(result);
  });

  it("filters full calendar months at month grain for monthly-only metrics", async () => {
    const timeRange = { startDate: "2026-08-01", endDate: "2026-10-31" };
    const groupBy = [
      { name: "metric_time", grain: "MONTH" as const },
      { name: "workspace_id" },
    ];
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(
        providerResult({
          data: {
            metricsPaginated: {
              items: [
                {
                  name: "monthly_ai_credits_consumed",
                  dimensions: [
                    {
                      name: "workspace_id",
                      type: "CATEGORICAL",
                      queryableGranularities: [],
                    },
                  ],
                  queryableGranularities: ["MONTH"],
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
          data: { createQuery: { queryId: "fake_monthly_query" } },
        }),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 1,
              jsonResult: JSON.stringify({
                data: [["2026-10-01", "workspace-synthetic", 42]],
              }),
            },
          },
        }),
      );

    const result = await runAction({
      metricName: "monthly_ai_credits_consumed",
      groupBy,
      timeRange,
      limit: 20,
    });

    expect(result).toMatchObject({
      status: "success",
      querySpec: { groupBy, timeRange },
      rows: [["2026-10-01", "workspace-synthetic", 42]],
    });
    expect(
      mocks.executeProviderApiRequest.mock.calls[1]?.[0].body.variables.where,
    ).toEqual([
      {
        sql: "{{ TimeDimension('metric_time', 'month') }} >= '2026-08-01'",
      },
      {
        sql: "{{ TimeDimension('metric_time', 'month') }} <= '2026-10-01'",
      },
    ]);
  });

  it("rejects partial calendar months for monthly-only metric filters", async () => {
    mocks.executeProviderApiRequest.mockResolvedValueOnce(
      providerResult({
        data: {
          metricsPaginated: {
            items: [
              {
                name: "monthly_ai_credits_consumed",
                dimensions: [],
                queryableGranularities: ["MONTH"],
              },
            ],
            totalItems: 1,
            totalPages: 1,
          },
        },
      }),
    );

    await expect(
      runAction({
        metricName: "monthly_ai_credits_consumed",
        timeRange: { startDate: "2026-08-15", endDate: "2026-10-31" },
      }),
    ).rejects.toMatchObject({ errorCode: "dbt_metric_grain_unsupported" });
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(1);
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

    const first = (await runAction({
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

    const second = (await runAction({
      metricName: "weekly_active_product_users",
      queryId: first.queryId,
      nextPage: first.nextPage,
      limit: 20,
    })) as any;
    expect(second).toMatchObject({
      status: "success",
      metric: {
        name: "weekly_active_product_users",
        dimensions: [
          {
            name: "root_org_id",
            description: "Synthetic organization identifier",
          },
        ],
      },
      querySpec: { groupBy, timeRange: metricTimeRange },
      rows: rows.slice(20),
      rowCount: 5,
      truncated: false,
    });
    expect(action.outputSchema.parse(second)).toEqual(second);
    expect(
      mocks.executeProviderApiRequest.mock.calls[3]?.[0].body.query,
    ).toContain("query AnalyticsMetricResult");
  });

  it("preserves metric dimensions through a pending result and cursor-only continuation", async () => {
    const dimensions = [
      {
        name: "root_org_id",
        description: "Owning organization identifier",
        type: "CATEGORICAL",
        queryableGranularities: [],
      },
    ];
    const groupBy = [
      { name: "metric_time", grain: "WEEK" as const },
      { name: "root_org_id" },
    ];
    const timeRange = { startDate: "2026-07-01", endDate: "2026-07-31" };
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(
        metricMetadataResult("weekly_active_product_users", dimensions),
      )
      .mockResolvedValueOnce(
        providerResult({
          data: { createQuery: { queryId: "fake_pending_group_query" } },
        }),
      )
      .mockRejectedValueOnce(providerRequestTimeoutError())
      .mockResolvedValueOnce(
        providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 1,
              jsonResult: JSON.stringify({
                data: [
                  {
                    metric_time__WEEK: "2026-07-06",
                    root_org_id: "org-1",
                    weekly_active_product_users: 12,
                  },
                ],
              }),
            },
          },
        }),
      );

    const pending = (await runAction({
      metricName: "weekly_active_product_users",
      groupBy,
      timeRange,
      limit: 20,
    })) as any;

    expect(pending).toMatchObject({
      status: "pending",
      queryId: "fake_pending_group_query",
      metric: {
        name: "weekly_active_product_users",
        dimensions: [
          {
            name: "root_org_id",
            description: "Owning organization identifier",
          },
        ],
      },
      querySpec: { groupBy, timeRange },
    });

    const continued = await runAction({
      metricName: "weekly_active_product_users",
      queryId: pending.queryId,
      nextPage: pending.nextPage,
      limit: 20,
    });

    expect(continued).toMatchObject({
      status: "success",
      metric: pending.metric,
      querySpec: { groupBy, timeRange },
      rows: [
        {
          metric_time__WEEK: "2026-07-06",
          root_org_id: "org-1",
          weekly_active_product_users: 12,
        },
      ],
    });
    expect(action.outputSchema.parse(pending)).toEqual(pending);
    expect(action.outputSchema.parse(continued)).toEqual(continued);
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(4);
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

    const result = await runAction({
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
      runAction({
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
      runAction({
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
      action.schema.safeParse({ metricName: "active_workspaces" }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        metricName: "active_workspaces",
        allTime: true,
      }).success,
    ).toBe(true);
    expect(
      action.schema.safeParse({
        metricName: "active_workspaces",
        timeRange: { startDate: "2026-07-01", endDate: "2026-07-31" },
      }).success,
    ).toBe(true);
    expect(
      action.schema.safeParse({
        metricName: "active_workspaces",
        allTime: true,
        timeRange: { startDate: "2026-07-01", endDate: "2026-07-31" },
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        metricName: "weekly_active_product_users",
        groupBy: [{ name: "root_org_id" }],
        allTime: true,
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
        nextPage: "metric-results-v5.eyJ0ZXN0IjoidHJ1ZSJ9",
        groupBy: [{ name: "root_org_id" }],
        timeRange: { startDate: "2026-07-01", endDate: "2026-07-31" },
      }).success,
    ).toBe(false);
    for (const nextPage of [
      "metric-results-v2.eyJ0ZXN0IjoidHJ1ZSJ9",
      "metric-results-v3.eyJ0ZXN0IjoidHJ1ZSJ9",
      "metric-results-v4.eyJ0ZXN0IjoidHJ1ZSJ9",
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
      runAction({ metricName: "synthetic_metric", limit: 20 }),
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

  it("reports connection_unavailable instead of asking for a choice when no listed dbt connection is ready", async () => {
    mocks.listWorkspaceConnectionsForApp.mockResolvedValueOnce([
      {
        ...connection,
        id: "conn_a",
        label: "Finance dbt",
        status: "needs_reauth",
      },
      { ...connection, id: "conn_b", label: "Staging dbt", status: "disabled" },
    ]);

    await expect(
      action.run({ metricName: "active_workspaces", limit: 20 }),
    ).resolves.toMatchObject({
      status: "connection_unavailable",
      metricName: "active_workspaces",
      connection: { id: "conn_a", label: "Finance dbt" },
    });
    expect(mocks.executeProviderApiRequest).not.toHaveBeenCalled();
  });

  it("offers a choice only among listed connections that are ready to query", async () => {
    mocks.listWorkspaceConnectionsForApp.mockResolvedValueOnce([
      connection,
      {
        ...connection,
        id: "conn_b",
        label: "Staging dbt",
        status: "needs_reauth",
      },
    ]);

    const result = await action.run({
      metricName: "active_workspaces",
      limit: 20,
    });
    expect(result).toMatchObject({ status: "connection_selection_required" });
    expect(
      (result as { connections: Array<{ id: string }> }).connections,
    ).toEqual([expect.objectContaining({ id: connection.id })]);
  });

  it("lists a connected row without an environment ID out of the choices", async () => {
    mocks.listWorkspaceConnectionsForApp.mockResolvedValueOnce([
      connection,
      { ...connection, id: "conn_b", label: "Staging dbt", config: {} },
    ]);

    const result = await action.run({
      metricName: "active_workspaces",
      limit: 20,
    });
    expect(
      (result as { connections: Array<{ id: string }> }).connections.map(
        (c) => c.id,
      ),
    ).toEqual([connection.id]);
  });

  it("counts a token reference on the Analytics grant as ready", async () => {
    mocks.listWorkspaceConnectionsForApp.mockResolvedValueOnce([
      {
        ...connection,
        id: "conn_a",
        credentialRefs: [],
        explicitGrant: {
          credentialRefs: [
            { key: "dbt_semantic_layer_token", scope: "org", provider: "dbt" },
          ],
        },
      },
      { ...connection, id: "conn_b", credentialRefs: [] },
    ]);

    const result = await action.run({
      metricName: "active_workspaces",
      limit: 20,
    });
    expect(result).toMatchObject({ status: "connection_selection_required" });
    expect(
      (result as { connections: Array<{ id: string }> }).connections.map(
        (c) => c.id,
      ),
    ).toEqual(["conn_a"]);
  });

  it("reports connection_error, not connection_unavailable, when the token lookup fails", async () => {
    mocks.hasAppSecret.mockRejectedValueOnce(new Error("secret store down"));
    mocks.listWorkspaceConnectionsForApp.mockResolvedValueOnce([
      connection,
      { ...connection, id: "conn_b", label: "Staging dbt" },
    ]);

    const result = await action.run({
      metricName: "active_workspaces",
      limit: 20,
    });

    expect(result).toMatchObject({
      status: "connection_error",
      message:
        "The dbt token could not be checked. Retry the request or check the workspace secrets.",
    });
    expect(result).not.toHaveProperty("connection");
    expect(mocks.executeProviderApiRequest).not.toHaveBeenCalled();
  });

  it("does not attribute a missing org context to one dbt connection", async () => {
    mocks.getRequestOrgId.mockReturnValueOnce(null);
    mocks.listWorkspaceConnectionsForApp.mockResolvedValueOnce([
      connection,
      { ...connection, id: "conn_b", label: "Staging dbt" },
    ]);

    const result = await action.run({
      metricName: "active_workspaces",
      limit: 20,
    });

    expect(result).toMatchObject({
      status: "connection_error",
      message:
        "The active organization is unavailable, so dbt connection readiness cannot be checked. Restore the organization context before retrying.",
    });
    expect(result).not.toHaveProperty("connection");
    expect(mocks.hasAppSecret).not.toHaveBeenCalled();
    expect(mocks.executeProviderApiRequest).not.toHaveBeenCalled();
  });

  it("reports connection_unavailable when every connected row lacks an environment or a token reference", async () => {
    mocks.listWorkspaceConnectionsForApp.mockResolvedValueOnce([
      { ...connection, id: "conn_a", label: "Finance dbt", config: {} },
      { ...connection, id: "conn_b", label: "Staging dbt", credentialRefs: [] },
    ]);

    await expect(
      action.run({ metricName: "active_workspaces", limit: 20 }),
    ).resolves.toMatchObject({
      status: "connection_unavailable",
      connection: { id: "conn_a", label: "Finance dbt" },
    });
    expect(mocks.executeProviderApiRequest).not.toHaveBeenCalled();
  });

  it("returns a clear deployment state when the environment has no successful run", async () => {
    mocks.executeProviderApiRequest.mockResolvedValueOnce(
      providerResult({
        errors: [{ message: "Environment needs a successful dbt run" }],
      }),
    );

    await expect(
      runAction({ metricName: "active_workspaces", limit: 20 }),
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
      runAction({ metricName: "active_workspaces", limit: 20 }),
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
      runAction({ metricName: "active_workspaces", limit: 20 }),
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
      runAction({ metricName: "active_workspaces", limit: 20 }),
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
      runAction({ metricName: "active_workspaces", limit: 20 }),
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
      runAction({ metricName: "active_workspaces", limit: 20 }),
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
      runAction({ metricName: "active_workspaces", limit: 20 }),
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
      runAction({ metricName: "active_workspaces", limit: 20 }),
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
      runAction({ metricName: "active_workspaces", limit: 20 }),
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
      runAction({ metricName: "active_workspaces", limit: 20 }),
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
      runAction({ metricName: "active_workspaces", limit: 20 }),
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
      runAction({ metricName: "active_workspaces", limit: 20 }),
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

    const first = (await runAction({
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

    const second = (await runAction({
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

    const third = await runAction({
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

  it.each([
    "querySpec",
    "metricDefinition",
    "signature",
    "malformedRowOffset",
  ] as const)(
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

      const first = (await runAction({
        metricName: "active_workspaces",
        limit: 20,
      })) as any;
      const cursorValue = String(first.nextPage);
      const signedPayload = cursorValue.slice("metric-results-v5.".length);
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
          : tamper === "metricDefinition"
            ? {
                ...parsedPayload,
                metricDefinition: {
                  ...parsedPayload.metricDefinition,
                  dimensions: [{ name: "organization_id" }],
                },
              }
            : tamper === "malformedRowOffset"
              ? { ...parsedPayload, rowOffset: 1_000 }
              : parsedPayload;
      const encodedTamperedPayload = Buffer.from(
        JSON.stringify(tamperedPayload),
      ).toString("base64url");
      const tamperedSignature =
        tamper === "signature"
          ? `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`
          : tamper === "malformedRowOffset"
            ? createHmac("sha256", "fake-dbt-token-for-tests")
                .update(
                  `agent-native:analytics:dbt-semantic-layer:metric-results:v5:${encodedTamperedPayload}`,
                )
                .digest("base64url")
            : signature;

      await expect(
        runAction({
          metricName: "active_workspaces",
          queryId: first.queryId,
          nextPage: `metric-results-v5.${encodedTamperedPayload}.${tamperedSignature}`,
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
    let result = (await runAction({
      metricName: "active_workspaces",
      limit: 100,
    })) as any;
    for (;;) {
      receivedRows.push(...result.rows);
      if (!result.nextPage) break;
      result = (await runAction({
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
    "returns a terminal provider error for $label totalPages",
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

      const result = await runAction({
        metricName: "active_workspaces",
        limit: 20,
      });

      expect(result).toMatchObject({
        status: "provider_error",
        message: expect.stringMatching(
          /pagination metadata|beyond the last available page/,
        ),
      });
      expect(result).not.toHaveProperty("queryId");
      expect(result).not.toHaveProperty("nextPage");
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

    const first = (await runAction({
      metricName: "active_workspaces",
      connectionId: connection.id,
      limit: 20,
    })) as any;
    const pending = await runAction({
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

    const interrupted = await runAction({
      metricName: "active_workspaces",
      limit: 20,
    });

    expect(interrupted).toMatchObject({
      status: "provider_error",
      queryId: "fake_query_1",
      querySpec: { groupBy: [], allTime: true },
      message: expect.stringContaining("Retry with the same metricName"),
    });
    expect((interrupted as any).nextPage).toMatch(/^metric-results-v5\./);
    expect(action.outputSchema.parse(interrupted)).toEqual(interrupted);

    const resumed = await runAction({
      metricName: "active_workspaces",
      queryId: (interrupted as any).queryId,
      nextPage: (interrupted as any).nextPage,
      limit: 20,
    });

    expect(resumed).toMatchObject({
      status: "success",
      queryId: "fake_query_1",
      querySpec: { groupBy: [], allTime: true },
      rows,
      rowCount: 1,
      truncated: false,
    });
    expect(resumed).toMatchObject({
      metric: {
        name: "active_workspaces",
        dimensions: [],
      },
    });
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
  ])(
    "terminates on %s without a retry cursor",
    async (_label, interruptedPoll) => {
      mocks.executeProviderApiRequest
        .mockResolvedValueOnce(metricMetadataResult())
        .mockResolvedValueOnce(
          providerResult({
            data: { createQuery: { queryId: "fake_query_1" } },
          }),
        )
        .mockResolvedValueOnce(providerResult(interruptedPoll));

      const interrupted = (await runAction({
        metricName: "active_workspaces",
        limit: 20,
      })) as any;

      expect(interrupted).toMatchObject({
        status: "provider_error",
        connection: { id: connection.id },
      });
      expect(interrupted).not.toHaveProperty("queryId");
      expect(interrupted).not.toHaveProperty("nextPage");
      expect(interrupted).not.toHaveProperty("querySpec");
      expect(action.outputSchema.parse(interrupted)).toEqual(interrupted);
      expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(3);
    },
  );

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

    const failed = await runAction({
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

  it("terminates an out-of-range signed result cursor without returning it for retry", async () => {
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
      );

    const first = (await runAction({
      metricName: "active_workspaces",
      limit: 20,
    })) as any;
    expect(first).toMatchObject({ status: "success", rowCount: 20 });
    expect(first.nextPage).toMatch(/^metric-results-v5\./);

    const signedPayload = String(first.nextPage).slice(
      "metric-results-v5.".length,
    );
    const separator = signedPayload.lastIndexOf(".");
    const payload = signedPayload.slice(0, separator);
    const cursor = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    const outOfRangePayload = Buffer.from(
      JSON.stringify({
        ...cursor,
        pageNum: 2,
        rowOffset: 0,
        rowsBeforePage: 25,
      }),
    ).toString("base64url");
    const signature = createHmac("sha256", "fake-dbt-token-for-tests")
      .update(
        `agent-native:analytics:dbt-semantic-layer:metric-results:v5:${outOfRangePayload}`,
      )
      .digest("base64url");

    const invalidPage = await runAction({
      metricName: "active_workspaces",
      queryId: first.queryId,
      nextPage: `metric-results-v5.${outOfRangePayload}.${signature}`,
      limit: 20,
    });

    expect(invalidPage).toMatchObject({
      status: "provider_error",
      message: expect.stringContaining("beyond the last available page"),
    });
    expect(invalidPage).not.toHaveProperty("queryId");
    expect(invalidPage).not.toHaveProperty("nextPage");
    expect(invalidPage).not.toHaveProperty("querySpec");
    expect(action.outputSchema.parse(invalidPage)).toEqual(invalidPage);
  });

  it("does not retry a signed row offset beyond the returned page", async () => {
    const pageRows = Array.from({ length: 25 }, (_, index) => ({
      value: index,
    }));
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
              jsonResult: JSON.stringify({ data: pageRows }),
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
              jsonResult: JSON.stringify({ data: pageRows }),
            },
          },
        }),
      );

    const first = (await runAction({
      metricName: "active_workspaces",
      limit: 20,
    })) as any;
    const signedPayload = String(first.nextPage).slice(
      "metric-results-v5.".length,
    );
    const separator = signedPayload.lastIndexOf(".");
    const payload = signedPayload.slice(0, separator);
    const cursor = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    const outOfRangePayload = Buffer.from(
      JSON.stringify({ ...cursor, rowOffset: 26 }),
    ).toString("base64url");
    const signature = createHmac("sha256", "fake-dbt-token-for-tests")
      .update(
        `agent-native:analytics:dbt-semantic-layer:metric-results:v5:${outOfRangePayload}`,
      )
      .digest("base64url");

    const invalidOffset = await runAction({
      metricName: "active_workspaces",
      queryId: first.queryId,
      nextPage: `metric-results-v5.${outOfRangePayload}.${signature}`,
      limit: 20,
    });

    expect(invalidOffset).toMatchObject({
      status: "provider_error",
      message: "dbt Semantic Layer returned an invalid metric result page.",
    });
    expect(invalidOffset).not.toHaveProperty("queryId");
    expect(invalidOffset).not.toHaveProperty("nextPage");
    expect(action.outputSchema.parse(invalidOffset)).toEqual(invalidOffset);
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

    const first = (await runAction({
      metricName: "active_workspaces",
      limit: 20,
    })) as any;

    await expect(
      runAction({
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

    const result = await runAction({
      metricName: "active_workspaces",
      limit: 20,
    });

    expect(result).toMatchObject({ status: "connection_error" });
    expect(result).not.toHaveProperty("queryId");
    expect(action.outputSchema.parse(result)).toEqual(result);
  });

  it("reports truncated metadata without offering an unsafe continuation cursor", async () => {
    mocks.executeProviderApiRequest.mockResolvedValueOnce(
      providerResult(undefined, 200, true, true),
    );

    const result = await runAction({
      metricName: "active_workspaces",
      limit: 20,
    });

    expect(result).toMatchObject({
      status: "provider_error",
      message: expect.stringContaining(
        "truncated the metric metadata response",
      ),
    });
    expect(result).not.toHaveProperty("queryId");
    expect(result).not.toHaveProperty("nextPage");
    expect(action.outputSchema.parse(result)).toEqual(result);
  });

  it("does not return the same result cursor after a truncated MetricFlow page", async () => {
    mocks.executeProviderApiRequest
      .mockResolvedValueOnce(metricMetadataResult())
      .mockResolvedValueOnce(
        providerResult({ data: { createQuery: { queryId: "fake_query_1" } } }),
      )
      .mockResolvedValueOnce(providerResult(undefined, 200, true, true));

    const result = await runAction({
      metricName: "active_workspaces",
      limit: 20,
    });

    expect(result).toMatchObject({
      status: "provider_error",
      message: expect.stringContaining("Narrow the date range"),
    });
    expect(result).not.toHaveProperty("queryId");
    expect(result).not.toHaveProperty("nextPage");
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

    const first = (await runAction({
      metricName: "active_workspaces",
      limit: 20,
    })) as any;
    const result = await runAction({
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

      const result = await runAction({
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

    const result = await runAction({
      metricName: "missing_metric",
      limit: 20,
    });
    expect(result).toMatchObject({
      status: "metadata_truncated",
      searched: 1_000,
      of: 1_500,
      truncated: true,
    });
    expect(result.nextPage).toMatch(/^metric-metadata-v2\./);
    const cursor = String(result.nextPage).slice("metric-metadata-v2.".length);
    const separator = cursor.lastIndexOf(".");
    const payload = JSON.parse(
      Buffer.from(cursor.slice(0, separator), "base64url").toString("utf8"),
    );
    expect(payload).toEqual({
      metricName: "missing_metric",
      connectionId: "dbt-workspace-connection",
      environmentId: "123456",
      pageNum: 11,
      searched: 1_000,
      of: 1_500,
      querySpec: { groupBy: [], allTime: true },
    });
    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(10);
  });

  it("continues metadata search with its signed cursor and cumulative inspected count", async () => {
    mocks.executeProviderApiRequest.mockImplementation(
      async ({ body }: any) => {
        if (body.query.includes("metricsPaginated")) {
          const pageNum = body.variables.pageNum;
          return providerResult({
            data: {
              metricsPaginated: {
                items:
                  pageNum === 11
                    ? [
                        {
                          name: "missing_metric",
                          dimensions: [],
                          queryableGranularities: ["DAY"],
                        },
                      ]
                    : Array.from({ length: 100 }, (_, index) => ({
                        name: `other_metric_${pageNum}_${index}`,
                      })),
                totalItems: 1_500,
                totalPages: 15,
                pageNum,
              },
            },
          });
        }
        if (body.query.includes("createQuery")) {
          return providerResult({
            data: { createQuery: { queryId: "fake_query_1" } },
          });
        }
        return providerResult({
          data: {
            query: {
              status: "SUCCESSFUL",
              totalPages: 1,
              jsonResult: JSON.stringify({ data: [[42]] }),
            },
          },
        });
      },
    );

    const first = (await runAction({
      metricName: "missing_metric",
      limit: 20,
    })) as any;
    expect(first).toMatchObject({
      status: "metadata_truncated",
      searched: 1_000,
    });

    const second = await action.run({
      metricName: "missing_metric",
      nextPage: first.nextPage,
      limit: 20,
    });

    expect(second).toMatchObject({ status: "success", rows: [[42]] });
    expect(
      mocks.executeProviderApiRequest.mock.calls[10]?.[0].body.variables
        .pageNum,
    ).toBe(11);
  });

  it("rejects a metadata cursor reused for another metric or altered page", async () => {
    mocks.executeProviderApiRequest.mockImplementation(async ({ body }: any) =>
      providerResult({
        data: {
          metricsPaginated: {
            items: Array.from({ length: 100 }, (_, index) => ({
              name: `other_metric_${body.variables.pageNum}_${index}`,
            })),
            totalItems: 1_500,
            totalPages: 15,
            pageNum: body.variables.pageNum,
          },
        },
      }),
    );
    const first = (await runAction({
      metricName: "missing_metric",
      limit: 20,
    })) as any;
    const cursor = String(first.nextPage);
    const signedPayload = cursor.slice("metric-metadata-v2.".length);
    const signatureSeparator = signedPayload.lastIndexOf(".");
    const encodedPayload = signedPayload.slice(0, signatureSeparator);
    const signature = signedPayload.slice(signatureSeparator + 1);
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
    const callsBeforeInvalidCursors =
      mocks.executeProviderApiRequest.mock.calls.length;

    await expect(
      runAction({
        metricName: "different_metric",
        nextPage: cursor,
        limit: 20,
      }),
    ).rejects.toMatchObject({ errorCode: "invalid_metric_metadata_cursor" });

    await expect(
      runAction({
        metricName: "missing_metric",
        nextPage: cursor,
        timeRange: { startDate: "2026-07-01", endDate: "2026-07-07" },
      }),
    ).rejects.toMatchObject({ errorCode: "invalid_metric_metadata_cursor" });

    const alteredPayload = Buffer.from(
      JSON.stringify({ ...payload, pageNum: payload.pageNum + 1 }),
    ).toString("base64url");
    await expect(
      runAction({
        metricName: "missing_metric",
        nextPage: `metric-metadata-v2.${alteredPayload}.${signature}`,
        limit: 20,
      }),
    ).rejects.toMatchObject({ errorCode: "invalid_metric_metadata_cursor" });

    expect(mocks.executeProviderApiRequest).toHaveBeenCalledTimes(
      callsBeforeInvalidCursors,
    );
  });
});
