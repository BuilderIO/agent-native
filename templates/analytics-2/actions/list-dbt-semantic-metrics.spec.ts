import { checkActionProperties } from "@agent-native/core/action-properties";
import { beforeEach, expect, it, vi } from "vitest";

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

import action from "./list-dbt-semantic-metrics.js";
const input = { connectionId: "qa-selected", pageNum: 2, pageSize: 100 };
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
const page = {
  items: [
    {
      name: "metric_101",
      description: "Orders",
      type: "SIMPLE",
      dimensions: [],
      queryableGranularities: [],
    },
  ],
  pageNum: 2,
  pageSize: 100,
  totalItems: 101,
  totalPages: 2,
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
  state.fetch.mockImplementation(async () =>
    Response.json({ data: { metricsPaginated: page } }),
  );
});

it("reads page two with only the selected native connection token and returns no private context", async () => {
  expect(await action.run(input, context)).toEqual({
    connectionId: input.connectionId,
    ...page,
  });
  expect(state.credential).toHaveBeenCalledExactlyOnceWith({
    appId: "analytics-2",
    provider: "bigquery",
    connectionId: input.connectionId,
    key: "WAREHOUSE_DBT_SERVICE_TOKEN",
  });
  expect(state.fetch).toHaveBeenCalledExactlyOnceWith(
    "https://metadata.semantic-layer.us1.dbt.com/api/graphql",
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer flagged-semantic-credential",
      }),
    }),
    expect.objectContaining({ httpsOnly: true, followRedirects: false }),
  );
  expect(JSON.parse(state.fetch.mock.calls[0]?.[1].body).variables).toEqual({
    environmentId: "42",
    pageNum: 2,
    pageSize: 100,
  });
});

it.each([
  ["disabled dbt", { hasDbtMetadata: false }],
  ["legacy", { dbtVersion: "legacy" }],
  ["draft", { draft: true }],
  ["substituted slot", { dbtCredentialKey: "OTHER_SLOT" }],
  ["invalid environment", { dbtEnvironmentId: "bad" }],
  ["invalid host", { dbtCloudHostname: "evil.invalid" }],
])("rejects %s before reading a secret", async (_name, patch) => {
  const changed = profile();
  Object.assign(changed.connection.config, patch);
  state.profile.mockResolvedValue(changed);
  await expect(action.run(input, context)).rejects.toThrow();
  expect(state.credential).not.toHaveBeenCalled();
  expect(state.fetch).not.toHaveBeenCalled();
});

it.each([
  null,
  { ...profile(), active: false },
  { ...profile(), connection: { ...connection(), id: "qa-other" } },
  { ...profile(), connection: { ...connection(), orgId: "other-workspace" } },
  { ...profile(), connection: { ...connection(), provider: "other" } },
  { ...profile(), connection: { ...connection(), credentialRefs: [] } },
])("rejects an unavailable or incoherent native profile %#", async (value) => {
  state.profile.mockResolvedValue(value);
  await expect(action.run(input, context)).rejects.toThrow();
  expect(state.credential).not.toHaveBeenCalled();
  expect(state.fetch).not.toHaveBeenCalled();
});
it("does not resolve credentials when the exact connection is not readable", async () => {
  state.connection.mockRejectedValue(new Error("unavailable"));
  await expect(action.run(input, context)).rejects.toThrow("unavailable");
  expect(state.credential).not.toHaveBeenCalled();
  expect(state.fetch).not.toHaveBeenCalled();
});
it.each(["missing_secret", "missing_context", "denied", "error"])(
  "fails closed for credential status %s without dispatch",
  async (status) => {
    state.credential.mockResolvedValue({ available: false, status });
    await expect(action.run(input, context)).rejects.toThrow();
    expect(state.fetch).not.toHaveBeenCalled();
  },
);
it("refuses an AI-excluded connection before credential resolution", async () => {
  state.included.mockResolvedValue(false);
  await expect(action.run(input, context)).rejects.toThrow("AI");
  expect(state.credential).not.toHaveBeenCalled();
  expect(state.fetch).not.toHaveBeenCalled();
});
it("does not infer metric lineage through excluded child resources", async () => {
  state.resources.mockResolvedValue({
    resources: [{ kind: "table", aiUsage: "excluded" }],
  });
  await expect(action.run(input, context)).rejects.toThrow("excluded");
  expect(state.credential).not.toHaveBeenCalled();
  expect(state.fetch).not.toHaveBeenCalled();
});
it("allows a frontend read without applying agent-only resource policy", async () => {
  state.included.mockResolvedValue(false);
  expect(await action.run(input, { caller: "frontend" })).toEqual({
    connectionId: input.connectionId,
    ...page,
  });
  expect(state.included).not.toHaveBeenCalled();
  expect(state.resources).not.toHaveBeenCalled();
});
it("rejects a secret rotation during credential resolution before dispatch", async () => {
  state.credential.mockImplementation(async () => {
    state.profile.mockResolvedValue({
      ...profile(),
      revision: "rotated-revision",
    });
    return {
      available: true,
      status: "available",
      value: "flagged-semantic-credential",
    };
  });
  await expect(action.run(input, context)).rejects.toThrow("changed");
  expect(state.fetch).not.toHaveBeenCalled();
});
it.each(["profile", "policy", "workspace", "actor"])(
  "withholds a provider result after %s changes",
  async (kind) => {
    state.fetch.mockImplementation(async () => {
      if (kind === "profile")
        state.profile.mockResolvedValue({
          ...profile(),
          revision: "changed-revision",
        });
      if (kind === "policy") state.revision.mockResolvedValue(2);
      if (kind === "workspace" || kind === "actor")
        state.workspace.mockResolvedValue({
          ownerEmail:
            kind === "actor" ? "other@example.invalid" : "qa@example.invalid",
          orgId: kind === "workspace" ? "other-workspace" : "qa-workspace",
          request: {},
        });
      return Response.json({ data: { metricsPaginated: page } });
    });
    await expect(action.run(input, context)).rejects.toThrow("changed");
    expect(state.fetch).toHaveBeenCalledTimes(1);
  },
);
it("never retries a refused provider request", async () => {
  state.fetch.mockResolvedValue(new Response("refused", { status: 403 }));
  await expect(action.run(input, context)).rejects.toMatchObject({
    statusCode: 403,
  });
  expect(state.fetch).toHaveBeenCalledTimes(1);
});
it("cancels before resolving any credentials", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    action.run(input, { caller: "agent", signal: controller.signal }),
  ).rejects.toThrow();
  expect(state.credential).not.toHaveBeenCalled();
  expect(state.fetch).not.toHaveBeenCalled();
});
it("declares a private read-only action with a typed output", async () => {
  await checkActionProperties(action, {
    runs: 15,
    context: { caller: "frontend" },
  });
  expect(action.readOnly).toBe(true);
  expect(action.persistInBrowser).toBe(false);
  expect(
    action.outputSchema?.parse({ connectionId: input.connectionId, ...page }),
  ).toEqual({ connectionId: input.connectionId, ...page });
});
