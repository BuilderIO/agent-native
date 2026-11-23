import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  credential: vi.fn(),
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: state.fetch,
}));
vi.mock("@agent-native/core/workspace-connections", () => ({
  resolveWorkspaceConnectionCredentialForApp: state.credential,
}));
import jobLinks from "./fixtures/warehouse-dbt-job-links.json";
import {
  readDbtTableMetadata,
  readDbtTableMetadataWithToken,
  validateDbtConfiguration,
  resolveDbtSemanticLayerEndpoint,
} from "./warehouse-dbt.js";

const config = {
  hasDbtMetadata: true,
  dbtVersion: "current",
  dbtCloudHostname: "cloud.getdbt.com",
  dbtEnvironmentId: "42",
};
const table = {
  projectId: "qa-project",
  datasetId: "analytics",
  tableId: "customers",
};
const connection = {
  id: "qa-connection",
  config: { ...config, dbtCredentialKey: "QA_DBT_CREDENTIAL" },
  credentialRefs: [{ key: "QA_DBT_CREDENTIAL" }],
};
const node = {
  uniqueId: "model.qa.customers",
  name: "customers",
  description: "Customer documentation",
  database: "qa-project",
  schema: "analytics",
  alias: "customers",
  catalog: {
    columns: [
      { name: "id", description: "Customer identifier", type: "INT64" },
    ],
  },
  executionInfo: { executeCompletedAt: "2026-11-06T10:00:00Z" },
  parents: [{ uniqueId: "source.qa.raw", name: "raw", resourceType: "Source" }],
  tests: [
    {
      name: "not_null_customers_id",
      columnName: "id",
      executionInfo: { lastRunStatus: "pass" },
    },
  ],
};
function response(json: unknown, status = 200) {
  return new Response(JSON.stringify(json), { status });
}
beforeEach(() => {
  vi.clearAllMocks();
  state.credential.mockResolvedValue({
    available: true,
    value: "fixture service credential",
  });
});

describe("dbt connection metadata", () => {
  it("validates the actual environment before a connection can save", async () => {
    state.fetch.mockResolvedValue(
      response({
        data: {
          environment: {
            applied: {
              models: {
                edges: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      }),
    );
    await validateDbtConfiguration(config, "fixture service credential");
    expect(state.fetch).toHaveBeenCalledWith(
      "https://metadata.cloud.getdbt.com/graphql",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Token fixture service credential",
        }),
      }),
      expect.objectContaining({ followRedirects: false, httpsOnly: true }),
    );
  });
  it("returns table docs, lineage, timestamps and tests from selected granted credential", async () => {
    state.fetch.mockResolvedValue(
      response({
        data: {
          environment: {
            applied: {
              models: {
                edges: [{ node }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      }),
    );
    const result = await readDbtTableMetadata(connection, table);
    expect(result).toMatchObject({
      uniqueId: "model.qa.customers",
      resourceType: "model",
      description: "Customer documentation",
      lastRefreshed: "2026-11-06T10:00:00Z",
      columns: [
        { name: "id", description: "Customer identifier", type: "INT64" },
      ],
      parents: [
        { uniqueId: "source.qa.raw", name: "raw", resourceType: "Source" },
      ],
      tests: [
        { name: "not_null_customers_id", status: "pass", columnName: "id" },
      ],
    });
    expect(state.credential).toHaveBeenCalledWith({
      appId: "analytics-2",
      provider: "bigquery",
      connectionId: "qa-connection",
      key: "QA_DBT_CREDENTIAL",
    });
    expect(JSON.stringify(result)).not.toContain("fixture service credential");
  });
  it("does not read an unrelated credential or disabled integration", async () => {
    expect(
      await readDbtTableMetadata(
        { ...connection, config: { hasDbtMetadata: false } },
        table,
      ),
    ).toBeNull();
    expect(state.credential).not.toHaveBeenCalled();
    await expect(
      readDbtTableMetadata({ ...connection, credentialRefs: [] }, table),
    ).rejects.toThrow("credentials");
    expect(state.fetch).not.toHaveBeenCalled();
  });
  it.each([
    "http://cloud.getdbt.com",
    "https://localhost",
    "https://cloud.getdbt.com.evil.invalid",
    "https://cloud.getdbt.com/path",
    "https://owner:secret@cloud.getdbt.com",
    "https://cloud.getdbt.com:444",
  ])("refuses unsafe access URL %s before credential use", async (host) => {
    await expect(
      validateDbtConfiguration(
        { ...config, dbtCloudHostname: host },
        "fixture service credential",
      ),
    ).rejects.toThrow("Access URL");
    expect(state.fetch).not.toHaveBeenCalled();
  });
  it("does not mistake GraphQL errors or denied credentials for an empty metadata result", async () => {
    state.fetch.mockResolvedValueOnce(
      response({
        errors: [{ message: "fixture service credential" }],
        data: null,
      }),
    );
    await expect(
      validateDbtConfiguration(config, "fixture service credential"),
    ).rejects.toThrow("dbt");
    state.fetch.mockResolvedValueOnce(
      response({ error: "fixture service credential" }, 401),
    );
    await expect(
      validateDbtConfiguration(config, "fixture service credential"),
    ).rejects.toThrow("Service token");
  });
  it("keeps a missing or unreadable environment distinct from no modeled tables", async () => {
    state.fetch.mockResolvedValue(response({ data: { environment: null } }));
    await expect(
      validateDbtConfiguration(config, "fixture service credential"),
    ).rejects.toThrow("environment");
  });
  it("rejects a repeated cursor rather than silently truncating metadata", async () => {
    state.fetch.mockImplementation(async () =>
      response({
        data: {
          environment: {
            applied: {
              models: {
                edges: [],
                pageInfo: { hasNextPage: true, endCursor: "repeat" },
              },
            },
          },
        },
      }),
    );
    await expect(readDbtTableMetadata(connection, table)).rejects.toThrow(
      "pagination",
    );
  });
  it("reports an unreadable credential store as retryable without a provider call", async () => {
    state.credential.mockResolvedValue({ available: false, status: "error" });
    await expect(readDbtTableMetadata(connection, table)).rejects.toMatchObject(
      { statusCode: 503 },
    );
    expect(state.fetch).not.toHaveBeenCalled();
  });
  it("does not present omitted selected test metadata as a clean empty tests list", async () => {
    const { tests: _tests, ...incomplete } = node;
    state.fetch.mockResolvedValue(
      response({
        data: {
          environment: {
            applied: {
              models: {
                edges: [{ node: incomplete }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      }),
    );
    await expect(readDbtTableMetadata(connection, table)).rejects.toThrow(
      "problem fetching dbt metadata",
    );
  });
  it("rejects malformed provider timestamps before they can reach browser date formatting", async () => {
    state.fetch.mockResolvedValue(
      response({
        data: {
          environment: {
            applied: {
              models: {
                edges: [
                  {
                    node: {
                      ...node,
                      executionInfo: { executeCompletedAt: "not a date" },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      }),
    );
    await expect(readDbtTableMetadata(connection, table)).rejects.toThrow(
      "problem fetching dbt metadata",
    );
  });
  it("resolves legacy docs-enabled jobs and reads their modeled table metadata", async () => {
    const legacy = {
      ...config,
      dbtVersion: "legacy",
      dbtAccountId: "7",
      dbtProjectId: "11",
    };
    state.fetch
      .mockResolvedValueOnce(
        response({
          data: [
            { id: 31, project_id: 11, environment_id: 42, generate_docs: true },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          data: {
            job: {
              models: [
                {
                  ...node,
                  columns: node.catalog.columns,
                  executeCompletedAt: "2026-11-06T10:00:00Z",
                  tests: [
                    { name: "not_null_id", status: "pass", columnName: "id" },
                  ],
                  accountId: 7,
                  projectId: 11,
                  runId: 57,
                },
              ],
            },
          },
        }),
      );
    const result = await readDbtTableMetadata(
      {
        ...connection,
        config: { ...legacy, dbtCredentialKey: "QA_DBT_CREDENTIAL" },
      },
      table,
    );
    expect(result).toMatchObject({
      uniqueId: "model.qa.customers",
      docsUrl:
        "https://cloud.getdbt.com/accounts/7/runs/57/docs/#!/model/model.qa.customers",
      tests: [{ name: "not_null_id", status: "pass" }],
    });
    expect(state.fetch.mock.calls[0]?.[0]).toContain(
      "/api/v2/accounts/7/jobs/?project_id=11",
    );
  });
  it("does not validate a legacy project that has no docs-enabled scheduled jobs", async () => {
    state.fetch.mockResolvedValue(
      response({
        data: [
          { id: 31, project_id: 11, environment_id: 42, generate_docs: false },
        ],
      }),
    );
    await expect(
      validateDbtConfiguration(
        {
          ...config,
          dbtVersion: "legacy",
          dbtAccountId: "7",
          dbtProjectId: "11",
        },
        "fixture service credential",
      ),
    ).rejects.toThrow("No dbt jobs found");
  });
  it("derives a multi-cell Discovery hostname without sending tokens to the access page", async () => {
    state.fetch.mockResolvedValue(
      response({
        data: { environment: { applied: { models: { edges: [] } } } },
      }),
    );
    await validateDbtConfiguration(
      { ...config, dbtCloudHostname: "https://account.us1.dbt.com" },
      "fixture service credential",
    );
    expect(state.fetch.mock.calls[0]?.[0]).toBe(
      "https://account.metadata.us1.dbt.com/graphql",
    );
  });
  it("derives Discovery and semantic hostnames for a dedicated cloud.<account>.getdbt.com Access URL", async () => {
    state.fetch.mockResolvedValue(
      response({
        data: { environment: { applied: { models: { edges: [] } } } },
      }),
    );
    await validateDbtConfiguration(
      { ...config, dbtCloudHostname: "https://cloud.acme.getdbt.com" },
      "fixture service credential",
    );
    expect(state.fetch.mock.calls[0]?.[0]).toBe(
      "https://metadata.cloud.acme.getdbt.com/graphql",
    );
    expect(
      resolveDbtSemanticLayerEndpoint({
        ...config,
        dbtCloudHostname: "cloud.acme.getdbt.com",
      }),
    ).toBe("https://semantic-layer.cloud.acme.getdbt.com/api/graphql");
  });
  it("uses source freshness when a table is a source rather than a model", async () => {
    state.fetch
      .mockResolvedValueOnce(
        response({
          data: {
            environment: {
              applied: {
                models: {
                  edges: [],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          data: {
            environment: {
              applied: {
                sources: {
                  edges: [
                    {
                      node: {
                        ...node,
                        uniqueId: "source.qa.customers",
                        identifier: "customers",
                        freshness: {
                          freshnessStatus: "pass",
                          maxLoadedAt: "2026-11-06T09:00:00Z",
                        },
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        }),
      );
    expect(await readDbtTableMetadata(connection, table)).toMatchObject({
      resourceType: "source",
      freshness: "pass",
      lastRefreshed: "2026-11-06T09:00:00Z",
    });
  });
  it("links current docs to the catalog-producing run rather than a model execution run", async () => {
    state.fetch.mockResolvedValue(
      response({
        data: {
          environment: {
            applied: {
              models: {
                edges: [
                  {
                    node: {
                      ...node,
                      accountId: 7,
                      projectId: 11,
                      catalog: {
                        ...node.catalog,
                        runId: 70,
                        runGeneratedAt: "2026-11-06T09:00:00Z",
                      },
                      executionInfo: {
                        executeCompletedAt: "2026-11-06T10:00:00Z",
                        lastSuccessRunId: 55,
                      },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      }),
    );
    expect(await readDbtTableMetadata(connection, table)).toMatchObject({
      docsUrl:
        "https://cloud.getdbt.com/accounts/7/runs/70/docs/#!/model/model.qa.customers",
    });
  });
  it("does not invent a docs link from a current execution run without a catalog run", async () => {
    state.fetch.mockResolvedValue(
      response({
        data: {
          environment: {
            applied: {
              models: {
                edges: [
                  {
                    node: {
                      ...node,
                      accountId: 7,
                      projectId: 11,
                      executionInfo: {
                        executeCompletedAt: "2026-11-06T10:00:00Z",
                        lastSuccessRunId: 55,
                      },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      }),
    );
    expect(await readDbtTableMetadata(connection, table)).toMatchObject({
      docsUrl: null,
    });
  });
  it.each([
    ["metadata.cloud.getdbt.com", "https://metadata.cloud.getdbt.com/graphql"],
    [
      "account.metadata.us1.dbt.com",
      "https://account.metadata.us1.dbt.com/graphql",
    ],
  ])(
    "normalizes a Discovery endpoint used as the Access URL: %s",
    async (host, expectedUrl) => {
      state.fetch.mockResolvedValueOnce(
        response({
          data: { environment: { applied: { models: { edges: [] } } } },
        }),
      );
      await expect(
        validateDbtConfiguration(
          { ...config, dbtCloudHostname: host },
          "fixture service credential",
        ),
      ).resolves.toBeUndefined();
      expect(state.fetch).toHaveBeenCalledWith(
        expectedUrl,
        expect.anything(),
        expect.anything(),
      );
    },
  );
  it.each([
    ["missing_secret", 409, "data_dbt_credentials_missing"],
    ["missing_context", 401, "data_dbt_auth_required"],
  ])(
    "distinguishes credential failure %s",
    async (status, statusCode, errorCode) => {
      state.credential.mockResolvedValue({ available: false, status });
      await expect(
        readDbtTableMetadata(connection, table),
      ).rejects.toMatchObject({ statusCode, errorCode });
      expect(state.fetch).not.toHaveBeenCalled();
    },
  );
  it("chooses the newest matching legacy run timestamp, regardless of job id or return order", async () => {
    const legacy = {
      ...connection,
      config: {
        ...connection.config,
        dbtVersion: "legacy",
        dbtAccountId: "7",
        dbtProjectId: "11",
      },
    };
    state.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("/api/"))
        return response({
          data: [
            { id: 90, project_id: 11, environment_id: 42, generate_docs: true },
            { id: 12, project_id: 11, environment_id: 42, generate_docs: true },
          ],
        });
      const args = JSON.parse(String(init.body));
      const newer = args.variables.jobId === "12";
      return response({
        data: {
          job: {
            models: [
              {
                ...node,
                description: newer ? "Current docs" : "Old docs",
                runGeneratedAt: newer
                  ? "2026-11-06T11:00:00Z"
                  : "2026-11-05T10:00:00Z",
                runId: newer ? 70 : 80,
              },
            ],
          },
        },
      });
    });
    expect(await readDbtTableMetadata(legacy, table)).toMatchObject({
      description: "Current docs",
    });
    expect(
      state.fetch.mock.calls.filter(([url]) => String(url).includes("/api/")),
    ).toHaveLength(1);
  });
  it("does not silently choose among ambiguous legacy matches with no run timestamp", async () => {
    const legacy = {
      ...connection,
      config: {
        ...connection.config,
        dbtVersion: "legacy",
        dbtAccountId: "7",
        dbtProjectId: "11",
      },
    };
    state.fetch.mockImplementation(async (url: string) =>
      url.includes("/api/")
        ? response({
            data: [
              {
                id: 90,
                project_id: 11,
                environment_id: 42,
                generate_docs: true,
              },
              {
                id: 12,
                project_id: 11,
                environment_id: 42,
                generate_docs: true,
              },
            ],
          })
        : response({
            data: {
              job: {
                models: [
                  {
                    ...node,
                    executionInfo: null,
                    executeCompletedAt: null,
                    maxLoadedAt: null,
                    runGeneratedAt: null,
                  },
                ],
              },
            },
          }),
    );
    await expect(readDbtTableMetadata(legacy, table)).rejects.toMatchObject({
      errorCode: "data_dbt_metadata_recency_unknown",
    });
  });
  it("lists legacy jobs once while checking both model and source metadata", async () => {
    const legacy = {
      ...connection,
      config: {
        ...connection.config,
        dbtVersion: "legacy",
        dbtAccountId: "7",
        dbtProjectId: "11",
      },
    };
    state.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("/api/"))
        return response({
          data: [
            { id: 12, project_id: 11, environment_id: 42, generate_docs: true },
          ],
        });
      const args = JSON.parse(String(init.body));
      return response({
        data: {
          job: args.query.includes("sources(")
            ? { sources: [] }
            : { models: [] },
        },
      });
    });
    expect(await readDbtTableMetadata(legacy, table)).toBeNull();
    expect(
      state.fetch.mock.calls.filter(([url]) => String(url).includes("/api/")),
    ).toHaveLength(1);
  });
  it("fails an exhausted overall metadata deadline instead of continuing across jobs", async () => {
    let now = 1000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const legacy = {
      ...connection,
      config: {
        ...connection.config,
        dbtVersion: "legacy",
        dbtAccountId: "7",
        dbtProjectId: "11",
      },
    };
    state.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      now += 8000;
      if (url.includes("/api/"))
        return response({
          data: [
            { id: 1, project_id: 11, environment_id: 42, generate_docs: true },
            { id: 2, project_id: 11, environment_id: 42, generate_docs: true },
            { id: 3, project_id: 11, environment_id: 42, generate_docs: true },
          ],
        });
      const args = JSON.parse(String(init.body));
      return response({
        data: {
          job: args.query.includes("sources(")
            ? { sources: [] }
            : { models: [] },
        },
      });
    });
    try {
      await expect(readDbtTableMetadata(legacy, table)).rejects.toMatchObject({
        errorCode: "data_dbt_request_budget_exhausted",
      });
    } finally {
      clock.mockRestore();
    }
  });
  it.each([
    "www.getdbt.com",
    "docs.getdbt.com",
    "support.getdbt.com",
    "login.dbt.com",
    "arbitrary.getdbt.com",
    "account.unknown.dbt.com",
  ])(
    "does not send integration credentials to a non-API provider host: %s",
    async (host) => {
      await expect(
        validateDbtConfiguration(
          {
            ...config,
            dbtVersion: "legacy",
            dbtAccountId: "7",
            dbtProjectId: "11",
            dbtCloudHostname: host,
          },
          "fixture service credential",
        ),
      ).rejects.toThrow("Access URL");
      expect(state.fetch).not.toHaveBeenCalled();
    },
  );
  it.each([
    "us1",
    "us5",
    "eu1",
    "au1",
    "jp1",
    "us3",
    "eu3",
    "eu4",
    "us2",
    "eu2",
    "au2",
  ])(
    "accepts the documented account Access URL for region %s",
    async (region) => {
      state.fetch.mockResolvedValue(
        response({
          data: { environment: { applied: { models: { edges: [] } } } },
        }),
      );
      await validateDbtConfiguration(
        { ...config, dbtCloudHostname: `qa-account.${region}.dbt.com` },
        "fixture service credential",
      );
      expect(state.fetch.mock.calls[0]?.[0]).toBe(
        `https://qa-account.metadata.${region}.dbt.com/graphql`,
      );
    },
  );
  it("validates a readable legacy docs job after an earlier job has no run", async () => {
    state.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("/api/"))
        return response({
          data: [
            { id: 1, project_id: 11, environment_id: 42, generate_docs: true },
            { id: 2, project_id: 11, environment_id: 42, generate_docs: true },
          ],
        });
      const args = JSON.parse(String(init.body));
      return response({
        data: { job: args.variables.jobId === "1" ? null : { models: [] } },
      });
    });
    await expect(
      validateDbtConfiguration(
        {
          ...config,
          dbtVersion: "legacy",
          dbtAccountId: "7",
          dbtProjectId: "11",
        },
        "fixture service credential",
      ),
    ).resolves.toBeUndefined();
  });
  it("fails legacy validation when every docs job has no readable run", async () => {
    state.fetch.mockImplementation(async (url: string) =>
      url.includes("/api/")
        ? response({
            data: [
              {
                id: 1,
                project_id: 11,
                environment_id: 42,
                generate_docs: true,
              },
              {
                id: 2,
                project_id: 11,
                environment_id: 42,
                generate_docs: true,
              },
            ],
          })
        : response({ data: { job: null } }),
    );
    await expect(
      validateDbtConfiguration(
        {
          ...config,
          dbtVersion: "legacy",
          dbtAccountId: "7",
          dbtProjectId: "11",
        },
        "fixture service credential",
      ),
    ).rejects.toThrow("No dbt metadata was found");
  });
  it("reads legacy metadata from a later docs job when an earlier job has no run", async () => {
    state.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("/api/"))
        return response({
          data: [
            { id: 1, project_id: 11, environment_id: 42, generate_docs: true },
            { id: 2, project_id: 11, environment_id: 42, generate_docs: true },
          ],
        });
      const args = JSON.parse(String(init.body));
      return response({
        data: {
          job:
            args.variables.jobId === "1"
              ? null
              : { models: [{ ...node, runId: 57 }] },
        },
      });
    });
    expect(
      await readDbtTableMetadata(
        {
          ...connection,
          config: {
            ...connection.config,
            dbtVersion: "legacy",
            dbtAccountId: "7",
            dbtProjectId: "11",
          },
        },
        table,
      ),
    ).toMatchObject({ uniqueId: "model.qa.customers" });
  });
  it("finds the source in a 33-job legacy project even after more than 64 HTTP requests", async () => {
    const jobs = Array.from({ length: 33 }, (_, index) => ({
      id: index + 1,
      project_id: 11,
      environment_id: 42,
      generate_docs: true,
    }));
    state.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("/api/")) return response({ data: jobs });
      const args = JSON.parse(String(init.body));
      return response({
        data: {
          job: args.query.includes("sources(")
            ? {
                sources:
                  args.variables.jobId === "33"
                    ? [
                        {
                          ...node,
                          uniqueId: "source.qa.customers",
                          identifier: "customers",
                          runId: 57,
                          state: "Pass",
                          maxLoadedAt: "2026-11-06T10:00:00Z",
                        },
                      ]
                    : [],
              }
            : { models: [] },
        },
      });
    });
    expect(
      await readDbtTableMetadata(
        {
          ...connection,
          config: {
            ...connection.config,
            dbtVersion: "legacy",
            dbtAccountId: "7",
            dbtProjectId: "11",
          },
        },
        table,
      ),
    ).toMatchObject({
      uniqueId: "source.qa.customers",
      resourceType: "source",
      freshness: "Pass",
    });
    expect(state.fetch.mock.calls.length).toBeGreaterThan(64);
    expect(
      state.fetch.mock.calls.filter(([url]) => String(url).includes("/api/")),
    ).toHaveLength(1);
  });
});

describe("dbt job links", () => {
  it.each(
    jobLinks.cases.filter(
      (entry) =>
        entry.version === "current" ||
        (entry.accountId !== null && entry.projectId !== null),
    ),
  )(
    "links $version $resourceType at $accessUrl account=$accountId project=$projectId run=$runId",
    async ({
      version,
      resourceType,
      accessUrl,
      accountId,
      projectId,
      runId,
      uniqueId,
      expected,
    }) => {
      const remoteNode = {
        ...node,
        uniqueId,
        accountId: accountId ?? undefined,
        projectId: projectId ?? undefined,
        ...(version === "current"
          ? { catalog: { ...node.catalog, runId }, identifier: "customers" }
          : { runId: runId ?? undefined, identifier: "customers" }),
      };
      state.fetch.mockImplementation(
        async (url: string, request: { body: string }) => {
          if (url.includes("/api/v2/"))
            return response({
              data: [
                {
                  id: 90,
                  project_id: 11,
                  environment_id: 42,
                  generate_docs: true,
                },
              ],
            });
          const body = JSON.parse(request.body) as { query: string };
          const kind = body.query.includes("sources(") ? "sources" : "models";
          const nodes = kind === `${resourceType}s` ? [remoteNode] : [];
          return response({
            data:
              version === "current"
                ? {
                    environment: {
                      applied: {
                        [kind]: {
                          edges: nodes.map((node) => ({ node })),
                          pageInfo: { hasNextPage: false, endCursor: null },
                        },
                      },
                    },
                  }
                : { job: { [kind]: nodes } },
          });
        },
      );
      const result = await readDbtTableMetadata(
        {
          ...connection,
          config: {
            ...connection.config,
            dbtVersion: version,
            dbtCloudHostname: accessUrl,
            ...(version === "legacy"
              ? {
                  dbtAccountId: String(accountId),
                  dbtProjectId: String(projectId),
                }
              : {}),
          },
        },
        table,
      );
      expect(result).toMatchObject(expected);
    },
  );
});

describe("dbt source freshness criteria transport", () => {
  it("requests Discovery thresholds and returns them for the selected source", async () => {
    const criteria = {
      warnAfter: { count: 2, period: "hour" },
      errorAfter: { count: 24, period: "hour" },
    };
    state.fetch
      .mockResolvedValueOnce(
        response({
          data: {
            environment: {
              applied: {
                models: {
                  edges: [],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          data: {
            environment: {
              applied: {
                sources: {
                  edges: [
                    {
                      node: {
                        ...node,
                        uniqueId: "source.qa.customers",
                        alias: null,
                        identifier: "customers",
                        freshness: {
                          freshnessStatus: "Warn",
                          maxLoadedAt: "2026-11-06T10:00:00Z",
                          criteria,
                        },
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        }),
      );
    const result = await readDbtTableMetadata(connection, table);
    expect(result).toMatchObject({
      resourceType: "source",
      freshness: "Warn",
      freshnessCriteria: criteria,
    });
    const sourceRequest = JSON.parse(
      String(state.fetch.mock.calls[1]?.[1]?.body),
    );
    expect(sourceRequest.query).toContain(
      "criteria { warnAfter { count period } errorAfter { count period } }",
    );
  });
});

describe("legacy dbt source freshness criteria", () => {
  it("reads legacy job criteria for the selected source", async () => {
    const criteria = {
      warnAfter: null,
      errorAfter: { count: 3, period: "day" },
    };
    state.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("/api/"))
        return response({
          data: [
            { id: 1, project_id: 11, environment_id: 42, generate_docs: true },
          ],
        });
      const args = JSON.parse(String(init.body));
      return response({
        data: {
          job: args.query.includes("sources(")
            ? {
                sources: [
                  {
                    ...node,
                    alias: null,
                    identifier: "customers",
                    uniqueId: "source.qa.customers",
                    runId: 57,
                    state: "Error",
                    criteria,
                  },
                ],
              }
            : { models: [] },
        },
      });
    });
    const result = await readDbtTableMetadata(
      {
        ...connection,
        config: {
          ...connection.config,
          dbtVersion: "legacy",
          dbtAccountId: "7",
          dbtProjectId: "11",
        },
      },
      table,
    );
    expect(result).toMatchObject({
      resourceType: "source",
      freshness: "Error",
      freshnessCriteria: criteria,
    });
    const requests = state.fetch.mock.calls
      .filter((call) => String(call[0]).includes("graphql"))
      .map((call) => JSON.parse(String(call[1]?.body)).query as string);
    expect(requests.find((query) => query.includes("sources("))).toContain(
      "criteria { warnAfter { count period } errorAfter { count period } }",
    );
  });
});

describe("explicit token dbt metadata read", () => {
  it("reads table metadata with an explicitly supplied token and no credential lookup", async () => {
    state.fetch.mockResolvedValue(
      response({
        data: {
          environment: {
            applied: {
              models: {
                edges: [{ node }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      }),
    );
    const result = await readDbtTableMetadataWithToken(
      config,
      "explicit plain fixture token",
      table,
    );
    expect(result).toMatchObject({
      uniqueId: "model.qa.customers",
      resourceType: "model",
    });
    expect(state.credential).not.toHaveBeenCalled();
    expect(state.fetch).toHaveBeenCalledWith(
      "https://metadata.cloud.getdbt.com/graphql",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Token explicit plain fixture token",
        }),
      }),
      expect.objectContaining({ followRedirects: false, httpsOnly: true }),
    );
  });
  it("keeps config denial without any credential lookup", async () => {
    await expect(
      readDbtTableMetadataWithToken(
        { ...config, dbtVersion: undefined },
        "explicit plain fixture token",
        table,
      ),
    ).rejects.toThrow();
    expect(state.credential).not.toHaveBeenCalled();
  });
});
