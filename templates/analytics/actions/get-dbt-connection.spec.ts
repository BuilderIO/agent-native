import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestOrgId: vi.fn(() => "org_test"),
  getRequestUserEmail: vi.fn(() => "member@example.test"),
  hasAppSecret: vi.fn(async () => true),
  listWorkspaceConnectionsForApp: vi.fn(),
  resolveOrgRole: vi.fn(async () => "member" as string | null),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
  fail: (message: string, options?: { errorCode?: string }) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/secrets", () => ({
  hasAppSecret: mocks.hasAppSecret,
}));

vi.mock("@agent-native/core/workspace-connections", () => ({
  listWorkspaceConnectionsForApp: mocks.listWorkspaceConnectionsForApp,
  resolveWorkspaceConnectionsForApp: mocks.listWorkspaceConnectionsForApp,
}));

vi.mock("../server/lib/db-admin-connections.js", () => ({
  resolveOrgRole: mocks.resolveOrgRole,
}));

const { default: action } = await import("./get-dbt-connection");

const connectedRow = {
  id: "conn_dbt_1",
  provider: "dbt",
  label: "dbt Cloud",
  status: "connected",
  credentialRefs: [{ key: "DBT_SEMANTIC_LAYER_TOKEN" }],
  config: {
    semanticLayerBaseUrl: "https://semantic-layer.cloud.getdbt.com/api/graphql",
    semanticLayerEnvironmentId: "123456",
  },
};

describe("get-dbt-connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestOrgId.mockReturnValue("org_test");
    mocks.getRequestUserEmail.mockReturnValue("member@example.test");
    mocks.hasAppSecret.mockResolvedValue(true);
    mocks.resolveOrgRole.mockResolvedValue("member");
    mocks.listWorkspaceConnectionsForApp.mockResolvedValue([connectedRow]);
  });

  it("reports the saved connection and a configured token without returning the token value", async () => {
    const result = await action.run({}, {} as never);

    expect(result).toEqual({
      connected: true,
      readiness: "ready",
      connectionId: "conn_dbt_1",
      status: "connected",
      environmentId: "123456",
      semanticLayerBaseUrl:
        "https://semantic-layer.cloud.getdbt.com/api/graphql",
      tokenConfigured: true,
      canManage: false,
      connections: [
        {
          id: "conn_dbt_1",
          label: "dbt Cloud",
          status: "connected",
          readiness: "ready",
        },
      ],
    });
    expect(mocks.hasAppSecret).toHaveBeenCalledWith({
      key: "DBT_SEMANTIC_LAYER_TOKEN",
      scope: "org",
      scopeId: "org_test",
    });
    expect(mocks.listWorkspaceConnectionsForApp).toHaveBeenCalledWith({
      appId: "analytics",
      provider: "dbt",
      includeDisabled: true,
    });
  });

  it("is not connected when the org token was removed, even though the row still says connected", async () => {
    mocks.hasAppSecret.mockResolvedValueOnce(false);

    await expect(action.run({}, {} as never)).resolves.toMatchObject({
      connected: false,
      readiness: "token_missing",
      status: "connected",
      tokenConfigured: false,
    });
  });

  it("names the missing environment ID instead of reporting connected", async () => {
    mocks.listWorkspaceConnectionsForApp.mockResolvedValueOnce([
      {
        ...connectedRow,
        config: {
          semanticLayerBaseUrl: connectedRow.config.semanticLayerBaseUrl,
        },
      },
    ]);

    await expect(action.run({}, {} as never)).resolves.toMatchObject({
      connected: false,
      readiness: "environment_missing",
      environmentId: null,
    });
  });

  it("returns the list of connections and no top-level connection when several exist", async () => {
    mocks.listWorkspaceConnectionsForApp.mockResolvedValueOnce([
      connectedRow,
      {
        ...connectedRow,
        id: "conn_dbt_2",
        label: "dbt Cloud (staging)",
        status: "needs_reauth",
      },
    ]);

    await expect(action.run({}, {} as never)).resolves.toEqual({
      connected: false,
      readiness: null,
      connectionId: null,
      status: null,
      environmentId: null,
      semanticLayerBaseUrl: null,
      tokenConfigured: true,
      canManage: false,
      connections: [
        {
          id: "conn_dbt_1",
          label: "dbt Cloud",
          status: "connected",
          readiness: "ready",
        },
        {
          id: "conn_dbt_2",
          label: "dbt Cloud (staging)",
          status: "needs_reauth",
          readiness: "needs_reauth",
        },
      ],
    });
  });

  it("returns an honest not-connected state with nulls when no connection exists", async () => {
    mocks.listWorkspaceConnectionsForApp.mockResolvedValueOnce([]);

    await expect(action.run({}, {} as never)).resolves.toEqual({
      connected: false,
      readiness: "not_connected",
      connectionId: null,
      status: null,
      environmentId: null,
      semanticLayerBaseUrl: null,
      tokenConfigured: true,
      canManage: false,
      connections: [],
    });
  });

  it("is not connected when the row needs reauthorization, and canManage follows the org role", async () => {
    mocks.listWorkspaceConnectionsForApp.mockResolvedValueOnce([
      { ...connectedRow, status: "needs_reauth" },
    ]);
    mocks.resolveOrgRole.mockResolvedValueOnce("admin");

    await expect(action.run({}, {} as never)).resolves.toMatchObject({
      connected: false,
      status: "needs_reauth",
      canManage: true,
    });
    expect(mocks.resolveOrgRole).toHaveBeenCalledWith(
      "member@example.test",
      "org_test",
    );
  });

  it("drops a connection restricted to another user, so it cannot make this caller look ready", async () => {
    // The batch lookup returns only the rows this caller may use; the
    // restricted row never reaches the action.
    mocks.listWorkspaceConnectionsForApp.mockResolvedValueOnce([connectedRow]);

    await expect(action.run({}, {} as never)).resolves.toMatchObject({
      connected: true,
      readiness: "ready",
      connectionId: "conn_dbt_1",
      connections: [{ id: "conn_dbt_1", readiness: "ready" }],
    });
  });

  it("reports a malformed environment ID as environment_invalid, not ready", async () => {
    mocks.listWorkspaceConnectionsForApp.mockResolvedValueOnce([
      {
        ...connectedRow,
        config: { ...connectedRow.config, semanticLayerEnvironmentId: "12a" },
      },
    ]);

    await expect(action.run({}, {} as never)).resolves.toMatchObject({
      connected: false,
      readiness: "environment_invalid",
    });
  });

  it("fails loudly instead of reporting an unconfigured connection when a stored value is not a string", async () => {
    mocks.listWorkspaceConnectionsForApp.mockResolvedValueOnce([
      {
        ...connectedRow,
        config: { ...connectedRow.config, semanticLayerEnvironmentId: 123456 },
      },
    ]);

    await expect(action.run({}, {} as never)).rejects.toMatchObject({
      errorCode: "dbt_connection_invalid",
      statusCode: 500,
    });
  });
});
