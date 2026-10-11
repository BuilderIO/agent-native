import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestOrgId: vi.fn(() => "org_test"),
  getRequestUserEmail: vi.fn(() => "owner@example.test"),
  hasAppSecret: vi.fn(async () => true),
  listWorkspaceConnectionsForApp: vi.fn(),
  upsertWorkspaceConnection: vi.fn(),
  requireAnalyticsAdminContext: vi.fn(),
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
  upsertWorkspaceConnection: mocks.upsertWorkspaceConnection,
}));

vi.mock("../server/lib/db-admin-connections.js", () => ({
  requireAnalyticsAdminContext: mocks.requireAnalyticsAdminContext,
}));

const { default: action } = await import("./save-dbt-connection");

const validInput = {
  environmentId: "123456",
  semanticLayerBaseUrl: "https://semantic-layer.cloud.getdbt.com/api/graphql",
};

const existingRow = {
  id: "conn_dbt_1",
  provider: "dbt",
  label: "Finance dbt",
  accountId: "acct_1",
  accountLabel: "Builder dbt",
  status: "disabled",
  scopes: ["semantic-layer"],
  config: {
    semanticLayerBaseUrl: "https://old.dbt.com/api/graphql",
    semanticLayerEnvironmentId: "999",
  },
  allowedApps: ["analytics", "design"],
  allowedUsers: ["ops@example.test"],
  allowedUserGroups: ["group_finance"],
  credentialRefs: [],
};

describe("save-dbt-connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestOrgId.mockReturnValue("org_test");
    mocks.getRequestUserEmail.mockReturnValue("owner@example.test");
    mocks.requireAnalyticsAdminContext.mockResolvedValue({
      userEmail: "owner@example.test",
      orgId: "org_test",
      role: "owner",
    });
    mocks.hasAppSecret.mockResolvedValue(true);
    mocks.listWorkspaceConnectionsForApp.mockResolvedValue([]);
    mocks.upsertWorkspaceConnection.mockImplementation(async (input) => ({
      ...input,
      id: input.id ?? "conn_new",
      status: input.status,
    }));
  });

  it("rejects a non-admin before validating or writing anything", async () => {
    mocks.requireAnalyticsAdminContext.mockRejectedValueOnce(
      new Error(
        "Only organization owners and admins can use Analytics admin tools.",
      ),
    );

    await expect(action.run(validInput, {} as never)).rejects.toThrow(
      "Only organization owners and admins",
    );
    expect(mocks.hasAppSecret).not.toHaveBeenCalled();
    expect(mocks.upsertWorkspaceConnection).not.toHaveBeenCalled();
  });

  it("rejects a save when the org token secret has not been saved yet", async () => {
    mocks.hasAppSecret.mockResolvedValueOnce(false);

    await expect(action.run(validInput, {} as never)).rejects.toMatchObject({
      errorCode: "dbt_token_required",
      statusCode: 409,
    });
    expect(mocks.hasAppSecret).toHaveBeenCalledWith({
      key: "DBT_SEMANTIC_LAYER_TOKEN",
      scope: "org",
      scopeId: "org_test",
    });
    expect(mocks.upsertWorkspaceConnection).not.toHaveBeenCalled();
  });

  it("rejects a non-digit environment ID", async () => {
    await expect(
      action.run({ ...validInput, environmentId: "12a" }, {} as never),
    ).rejects.toMatchObject({ errorCode: "dbt_environment_invalid" });
    expect(mocks.upsertWorkspaceConnection).not.toHaveBeenCalled();
  });

  it.each([
    ["plain http", "http://semantic-layer.cloud.getdbt.com/api/graphql"],
    ["a non-dbt host", "https://api.example.test/api/graphql"],
    ["a lookalike suffix", "https://evilgetdbt.com/api/graphql"],
    [
      "a dbt name as a subdomain of another host",
      "https://dbt.com.example.test/api",
    ],
    [
      "embedded credentials",
      "https://user:pass@semantic-layer.cloud.getdbt.com/api/graphql",
    ],
    ["not a URL", "semantic-layer.cloud.getdbt.com"],
  ])("rejects a base URL with %s", async (_label, semanticLayerBaseUrl) => {
    await expect(
      action.run({ ...validInput, semanticLayerBaseUrl }, {} as never),
    ).rejects.toMatchObject({ errorCode: "dbt_base_url_invalid" });
    expect(mocks.upsertWorkspaceConnection).not.toHaveBeenCalled();
  });

  it("upserts the dbt connection with the expected config and credential ref", async () => {
    await expect(action.run(validInput, {} as never)).resolves.toEqual({
      connectionId: "conn_new",
      status: "connected",
      environmentId: "123456",
      semanticLayerBaseUrl:
        "https://semantic-layer.cloud.getdbt.com/api/graphql",
    });
    expect(mocks.upsertWorkspaceConnection).toHaveBeenCalledWith({
      id: undefined,
      provider: "dbt",
      label: "dbt Cloud",
      accountId: null,
      accountLabel: null,
      status: "connected",
      scopes: [],
      config: {
        semanticLayerBaseUrl:
          "https://semantic-layer.cloud.getdbt.com/api/graphql",
        semanticLayerEnvironmentId: "123456",
      },
      allowedApps: ["analytics"],
      allowedUsers: [],
      allowedUserGroups: [],
      credentialRefs: [
        { key: "DBT_SEMANTIC_LAYER_TOKEN", scope: "org", provider: "dbt" },
      ],
    });
  });

  it("carries forward the existing row's id, label, app access, scopes, and groups on re-save", async () => {
    mocks.listWorkspaceConnectionsForApp.mockResolvedValueOnce([existingRow]);

    await action.run(validInput, {} as never);

    expect(mocks.upsertWorkspaceConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "conn_dbt_1",
        label: "Finance dbt",
        accountId: "acct_1",
        accountLabel: "Builder dbt",
        scopes: ["semantic-layer"],
        allowedApps: ["analytics", "design"],
        allowedUsers: ["ops@example.test"],
        allowedUserGroups: ["group_finance"],
        status: "connected",
        config: {
          semanticLayerBaseUrl:
            "https://semantic-layer.cloud.getdbt.com/api/graphql",
          semanticLayerEnvironmentId: "123456",
        },
      }),
    );
  });
});
