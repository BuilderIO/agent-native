import { checkActionProperties } from "@agent-native/core/action-properties";
import fc from "fast-check";
import { beforeEach, expect, it, vi } from "vitest";

import { queryDbtSemanticMetricsInput } from "../shared/dbt-semantic-metrics";

const state = vi.hoisted(() => ({
  workspace: vi.fn(),
  profile: vi.fn(),
  credential: vi.fn(),
  connection: vi.fn(),
  included: vi.fn(),
  revision: vi.fn(),
  resources: vi.fn(),
  fetch: vi.fn(),
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
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: state.fetch,
}));

import action from "./query-dbt-semantic-metrics.js";

const input = {
  connectionId: "qa-selected",
  metrics: [{ name: "revenue" }],
  groupBy: [{ name: "metric_time", grain: "MONTH" as const }],
  limit: 10,
};
const context = { caller: "agent" } as const;
const connection = () => ({
  id: input.connectionId,
  provider: "bigquery",
  orgId: "qa-workspace",
  status: "connected",
  config: {
    hasDbtMetadata: true,
    dbtVersion: "current",
    dbtEnvironmentId: "42",
    dbtCloudHostname: "metadata.us1.dbt.com",
    dbtCredentialKey: "WAREHOUSE_DBT_SERVICE_TOKEN",
  },
  credentialRefs: [{ key: "WAREHOUSE_DBT_SERVICE_TOKEN" }],
});
const profile = () => ({
  profile: "workspace-v1",
  active: true,
  revision: "initial-revision",
  connection: connection(),
});
const table = {
  schema: { fields: [{ name: "revenue", type: "DOUBLE" }] },
  data: [{ revenue: 42 }],
};
const successful = {
  status: "SUCCESSFUL",
  error: null,
  totalPages: 1,
  sql: "select 1",
  jsonResult: JSON.stringify(table),
};

beforeEach(() => {
  vi.resetAllMocks();
  state.workspace.mockResolvedValue({
    ownerEmail: "qa@example.invalid",
    orgId: "qa-workspace",
    request: { userEmail: "qa@example.invalid", orgId: "qa-workspace" },
  });
  state.connection.mockImplementation(async () => connection());
  state.profile.mockImplementation(async () => profile());
  state.credential.mockResolvedValue({
    available: true,
    status: "available",
    value: "flagged-semantic-credential",
  });
  state.included.mockResolvedValue(true);
  state.revision.mockResolvedValue(1);
  state.resources.mockResolvedValue({ resources: [] });
  state.fetch
    .mockResolvedValueOnce(
      Response.json({ data: { createQuery: { queryId: "query-1" } } }),
    )
    .mockResolvedValueOnce(Response.json({ data: { query: successful } }));
});

it("starts one metric query and returns its first page", async () => {
  const result = await action.run(input, context);
  expect(result).toEqual({
    connectionId: input.connectionId,
    queryId: "query-1",
    status: "SUCCESSFUL",
    pageNum: 1,
    totalPages: 1,
    sql: "select 1",
    fields: table.schema.fields,
    rows: table.data,
    hasMore: false,
  });
  expect(state.fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(state.fetch.mock.calls[0]?.[1].body).variables).toEqual({
    environmentId: "42",
    metrics: input.metrics,
    groupBy: input.groupBy,
    limit: 10,
  });
  expect(JSON.parse(state.fetch.mock.calls[1]?.[1].body).variables).toEqual({
    environmentId: "42",
    queryId: "query-1",
    pageNum: 1,
  });
  expect(JSON.stringify(result)).not.toContain("flagged-semantic-credential");
});

it("polls a pending metric query before reading its page", async () => {
  state.fetch.mockReset();
  state.fetch
    .mockResolvedValueOnce(
      Response.json({ data: { createQuery: { queryId: "query-2" } } }),
    )
    .mockResolvedValueOnce(
      Response.json({
        data: {
          query: {
            status: "RUNNING",
            error: null,
            totalPages: null,
            sql: null,
            jsonResult: null,
          },
        },
      }),
    )
    .mockResolvedValueOnce(Response.json({ data: { query: successful } }));
  const result = await action.run(input, context);
  expect(result.queryId).toBe("query-2");
  expect(result.rows).toEqual(table.data);
  expect(state.fetch).toHaveBeenCalledTimes(3);
});

function queryReply(overrides: Record<string, unknown>) {
  return Response.json({
    data: {
      query: {
        status: "COMPILED",
        error: null,
        totalPages: null,
        sql: null,
        jsonResult: null,
        ...overrides,
      },
    },
  });
}

function startReply(queryId: string) {
  return Response.json({ data: { createQuery: { queryId } } });
}

it("polls a compiled metric query until it succeeds", async () => {
  state.fetch.mockReset();
  state.fetch
    .mockResolvedValueOnce(startReply("query-3"))
    .mockResolvedValueOnce(queryReply({ sql: "select 1" }))
    .mockResolvedValueOnce(Response.json({ data: { query: successful } }));
  const result = await action.run(input, context);
  expect(result.queryId).toBe("query-3");
  expect(result.status).toBe("SUCCESSFUL");
  expect(result.rows).toEqual(table.data);
  expect(state.fetch).toHaveBeenCalledTimes(3);
});

it("returns a typed failure when a compiled metric query fails", async () => {
  state.fetch.mockReset();
  state.fetch
    .mockResolvedValueOnce(startReply("query-4"))
    .mockResolvedValueOnce(queryReply({}))
    .mockResolvedValueOnce(
      queryReply({ status: "FAILED", error: "flagged-semantic-credential" }),
    );
  const attempt = action.run(input, context);
  await expect(attempt).rejects.toMatchObject({
    statusCode: 502,
    errorCode: "dbt_semantic_query_failed",
  });
  await expect(attempt).rejects.not.toThrow("flagged-semantic-credential");
  expect(state.fetch).toHaveBeenCalledTimes(3);
});

it("rejects an unknown metric query status without polling further", async () => {
  state.fetch.mockReset();
  state.fetch
    .mockResolvedValueOnce(startReply("query-5"))
    .mockResolvedValueOnce(queryReply({ status: "CANCELLED" }));
  await expect(action.run(input, context)).rejects.toMatchObject({
    statusCode: 502,
    errorCode: "dbt_semantic_response_invalid",
  });
  expect(state.fetch).toHaveBeenCalledTimes(2);
});

it("times out a metric query that stays compiled past the deadline", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    state.fetch.mockReset();
    state.fetch
      .mockResolvedValueOnce(startReply("query-6"))
      .mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + 60_000);
        return queryReply({});
      });
    await expect(action.run(input, context)).rejects.toMatchObject({
      statusCode: 504,
      errorCode: "dbt_semantic_timeout",
    });
    expect(state.fetch).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("rejects disabled dbt before reading the token or calling the provider", async () => {
  const changed = profile();
  changed.connection.config.hasDbtMetadata = false;
  state.profile.mockResolvedValue(changed);
  await expect(action.run(input, context)).rejects.toThrow();
  expect(state.credential).not.toHaveBeenCalled();
  expect(state.fetch).not.toHaveBeenCalled();
});

it("returns the provider denial without a retry", async () => {
  state.fetch.mockReset();
  state.fetch.mockResolvedValueOnce(new Response("", { status: 401 }));
  await expect(action.run(input, context)).rejects.toMatchObject({
    statusCode: 401,
    errorCode: "dbt_semantic_access_denied",
  });
  expect(state.fetch).toHaveBeenCalledTimes(1);
});

it("declares a private read-only action with a typed output", async () => {
  await checkActionProperties(action, {
    runs: 15,
    context: { caller: "frontend" },
    // JSON Schema cannot express trim-before-min; generate schema-valid IDs.
    overrides: {
      "/connectionId": fc
        .string({ minLength: 1, maxLength: 500 })
        .filter((id) => id.trim().length > 0),
    },
  });
  expect(
    queryDbtSemanticMetricsInput.safeParse({ ...input, connectionId: " " })
      .success,
  ).toBe(false);
  expect(action.readOnly).toBe(true);
  expect(action.persistInBrowser).toBe(false);
});
