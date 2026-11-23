import { beforeEach, expect, it, vi } from "vitest";

import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../shared/bigquery-source-contract.js";

const state = vi.hoisted(() => ({
  workspace: vi.fn(),
  profile: vi.fn(),
  credential: vi.fn(),
  connection: vi.fn(),
  included: vi.fn(),
  revision: vi.fn(),
  resources: vi.fn(),
  fetch: vi.fn(),
  readiness: vi.fn(),
  requireContext: vi.fn(),
  orgDbtConfig: vi.fn(),
  orgDbtToken: vi.fn(),
}));

vi.mock("../server/lib/workspace-access.js", () => ({
  APPLICATION_ID: "analytics-2",
  requireCurrentWorkspace: state.workspace,
}));
vi.mock("@agent-native/core/workspace-connections", () => ({
  readWorkspaceCredentialProfile: state.profile,
  resolveWorkspaceConnectionCredentialForApp: state.credential,
}));
vi.mock("../server/model/data-connections.js", () => ({
  readDataConnection: state.connection,
  connectionIncludedForAgent: state.included,
}));
vi.mock("../server/model/data-resource-metadata.js", () => ({
  readResourcePolicyRevision: state.revision,
  readDataResourceMetadata: state.resources,
}));
vi.mock("../server/lib/org-bigquery-credentials.js", () => ({
  getOrganizationBigQueryCredentialReadiness: state.readiness,
}));
vi.mock("../server/lib/org-bigquery-dbt.js", () => ({
  requireExactDbtRequestContext: state.requireContext,
  readOrganizationDbtConfig: state.orgDbtConfig,
  readDbtServiceToken: state.orgDbtToken,
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: state.fetch,
}));

import listAction from "./list-dbt-semantic-metrics.js";
import queryAction from "./query-dbt-semantic-metrics.js";

const listInput = {
  connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
  pageNum: 1,
  pageSize: 50,
};
const queryInput = {
  connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
  metrics: [{ name: "revenue" }],
  groupBy: [{ name: "metric_time", grain: "MONTH" as const }],
  limit: 10,
};
const agentContext = { caller: "agent" } as const;
const orgConfig = () => ({
  status: "configured" as const,
  revision: 3,
  config: {
    hasDbtMetadata: true,
    dbtVersion: "current" as const,
    dbtEnvironmentId: "42",
    dbtCloudHostname: "metadata.us1.dbt.com",
  },
});
const page = {
  items: [
    {
      name: "revenue",
      description: "Total revenue",
      type: "SIMPLE",
      dimensions: [],
      queryableGranularities: ["MONTH"],
    },
  ],
  pageNum: 1,
  pageSize: 50,
  totalItems: 1,
  totalPages: 1,
};
const queryTable = {
  schema: { fields: [{ name: "revenue", type: "DOUBLE" }] },
  data: [{ revenue: 123 }],
};

beforeEach(() => {
  vi.resetAllMocks();
  state.workspace.mockResolvedValue({
    ownerEmail: "qa@example.invalid",
    orgId: "qa-workspace",
    request: { userEmail: "qa@example.invalid", orgId: "qa-workspace" },
  });
  state.connection.mockRejectedValue(new Error("Data connection not found."));
  state.readiness.mockResolvedValue("configured");
  state.requireContext.mockReturnValue({
    orgId: "qa-workspace",
    userEmail: "qa@example.invalid",
  });
  state.orgDbtConfig.mockImplementation(async () => orgConfig());
  state.orgDbtToken.mockResolvedValue("flagged-org-dbt-token");
  state.included.mockResolvedValue(true);
  state.revision.mockResolvedValue(1);
  state.resources.mockResolvedValue({ resources: [] });
  state.fetch.mockImplementation(async () =>
    Response.json({ data: { metricsPaginated: page } }),
  );
});

it("lists Semantic Layer metrics for the organization BigQuery connection using org dbt config and token", async () => {
  const result = await listAction.run(listInput, agentContext);
  expect(result).toEqual({
    connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
    ...page,
  });
  expect(state.connection).not.toHaveBeenCalled();
  expect(state.profile).not.toHaveBeenCalled();
  expect(state.orgDbtToken).toHaveBeenCalledExactlyOnceWith("qa-workspace");
  expect(state.fetch).toHaveBeenCalledExactlyOnceWith(
    "https://metadata.semantic-layer.us1.dbt.com/api/graphql",
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer flagged-org-dbt-token",
      }),
    }),
    expect.objectContaining({ httpsOnly: true, followRedirects: false }),
  );
  expect(JSON.stringify(result)).not.toContain("flagged-org-dbt-token");
});

it("queries Semantic Layer metrics for the organization BigQuery connection", async () => {
  state.fetch
    .mockResolvedValueOnce(
      Response.json({ data: { createQuery: { queryId: "org-q-1" } } }),
    )
    .mockResolvedValueOnce(
      Response.json({
        data: {
          query: {
            status: "SUCCESSFUL",
            error: null,
            totalPages: 1,
            sql: "select 123 as revenue",
            jsonResult: JSON.stringify(queryTable),
          },
        },
      }),
    );

  const result = await queryAction.run(queryInput, agentContext);
  expect(result).toEqual({
    connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
    queryId: "org-q-1",
    status: "SUCCESSFUL",
    pageNum: 1,
    totalPages: 1,
    sql: "select 123 as revenue",
    fields: queryTable.schema.fields,
    rows: queryTable.data,
    hasMore: false,
  });
  expect(JSON.stringify(result)).not.toContain("flagged-org-dbt-token");
});

it.each([
  ["absent config", { status: "absent" as const }],
  [
    "disabled dbt",
    {
      ...orgConfig(),
      config: { ...orgConfig().config, hasDbtMetadata: false },
    },
  ],
  [
    "legacy dbt",
    {
      ...orgConfig(),
      config: { ...orgConfig().config, dbtVersion: "legacy" as const },
    },
  ],
  [
    "invalid environment",
    {
      ...orgConfig(),
      config: { ...orgConfig().config, dbtEnvironmentId: "bad" },
    },
  ],
  [
    "invalid hostname",
    {
      ...orgConfig(),
      config: { ...orgConfig().config, dbtCloudHostname: "evil.invalid" },
    },
  ],
])(
  "rejects organization %s before reading the dbt token",
  async (_name, cfg) => {
    state.orgDbtConfig.mockResolvedValue(cfg);
    await expect(listAction.run(listInput, agentContext)).rejects.toMatchObject(
      {
        errorCode: "dbt_semantic_configuration_invalid",
      },
    );
    expect(state.orgDbtToken).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
  },
);

it("rejects organization BigQuery when credential readiness is not configured", async () => {
  state.readiness.mockResolvedValue("missing");
  await expect(listAction.run(listInput, agentContext)).rejects.toMatchObject({
    statusCode: 403,
    errorCode: "dbt_semantic_connection_unavailable",
  });
  expect(state.orgDbtToken).not.toHaveBeenCalled();
  expect(state.fetch).not.toHaveBeenCalled();
});

it("enforces agent AI exclusion on the organization BigQuery connection while permitting frontend reads", async () => {
  state.included.mockResolvedValue(false);
  await expect(listAction.run(listInput, agentContext)).rejects.toMatchObject({
    statusCode: 403,
    errorCode: "data_connection_ai_disabled",
  });
  expect(state.orgDbtToken).not.toHaveBeenCalled();

  const frontendResult = await listAction.run(listInput, {
    caller: "frontend",
  });
  expect(frontendResult.items).toEqual(page.items);
});

it("withholds provider results when the organization dbt config revision changes mid-request", async () => {
  state.fetch.mockImplementation(async () => {
    state.orgDbtConfig.mockResolvedValue({ ...orgConfig(), revision: 4 });
    return Response.json({ data: { metricsPaginated: page } });
  });
  await expect(listAction.run(listInput, agentContext)).rejects.toMatchObject({
    statusCode: 409,
    errorCode: "dbt_semantic_configuration_changed",
  });
  expect(state.fetch).toHaveBeenCalledTimes(1);
});
