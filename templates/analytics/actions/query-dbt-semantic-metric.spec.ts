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
      .mockResolvedValue(
        providerResult({
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
    expect(action.outputSchema.parse(pending)).toEqual(pending);
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
    mocks.executeProviderApiRequest.mockResolvedValueOnce(
      providerResult({ errors: [{ message: "Gateway timeout" }] }, 504, false),
    );

    const result = await action.run({
      metricName: "active_workspaces",
      queryId: "fake_query_1",
      limit: 20,
    });

    expect(result).toMatchObject({
      status: "pending",
      queryId: "fake_query_1",
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
