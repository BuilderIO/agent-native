import { createHmac } from "node:crypto";

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "@agent-native/core/app-config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  extractA2APersistedMutationReceipts,
  stripA2APersistedArtifactMarkers,
} from "../../../../core/src/a2a/artifact-response.js";

const mocks = vi.hoisted(() => ({
  discoverAgents: vi.fn(),
  directoryStatus: vi.fn(),
  getBuiltinAgents: vi.fn(() => []),
  listWorkspaceApps: vi.fn(),
  getUserSetting: vi.fn(),
  getOrgSetting: vi.fn(),
  createEmbedSessionTicket: vi.fn(),
  buildEmbedStartPath: vi.fn((ticket: string) => {
    return `/_agent-native/embed/start?ticket=${encodeURIComponent(ticket)}`;
  }),
  listRemoteServers: vi.fn(),
  getMcpOAuthAccessToken: vi.fn(),
  managerStart: vi.fn(),
  managerGetConnectErrorStatus: vi.fn(),
  managerStop: vi.fn(),
  managerCallTool: vi.fn(),
  managerConstructor: vi.fn(),
  resolveChildBrowserTab: vi.fn(),
  managerHasServer: vi.fn(),
  managerGetTool: vi.fn(),
  managerGetToolsForServer: vi.fn(),
  a2aConstructor: vi.fn(),
  a2aSend: vi.fn(),
  a2aGetTask: vi.fn(),
  signA2AOrgMemberDelegationToken: vi.fn(),
  signA2AOrganizationToken: vi.fn(),
  signA2AToken: vi.fn(),
  canonicalA2AAudience: vi.fn((url: string) => url.replace(/\/+$/, "")),
  getOrgA2ASecret: vi.fn(),
  getOrgDomain: vi.fn(),
  isFeatureFlagEnabled: vi.fn(),
}));

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  discoverAgents: mocks.discoverAgents,
  discoverAgentsWithDirectoryStatus: async (...args: unknown[]) => ({
    agents: await mocks.discoverAgents(...args),
    directory: mocks.directoryStatus(),
  }),
  getBuiltinAgents: mocks.getBuiltinAgents,
}));

vi.mock("./dispatch-pane-context.js", () => ({
  resolveDispatchChildBrowserTab: mocks.resolveChildBrowserTab,
}));

vi.mock("./app-creation-store.js", () => ({
  listWorkspaceApps: mocks.listWorkspaceApps,
}));

vi.mock("@agent-native/core/feature-flags", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/feature-flags")>();
  return {
    ...actual,
    isFeatureFlagEnabled: mocks.isFeatureFlagEnabled,
  };
});

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
  getOrgSetting: mocks.getOrgSetting,
  putUserSetting: vi.fn(),
  putOrgSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...actual,
    createEmbedSessionTicket: mocks.createEmbedSessionTicket,
    buildEmbedStartPath: mocks.buildEmbedStartPath,
  };
});

vi.mock("@agent-native/core/a2a", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/a2a")>();
  return {
    ...actual,
    extractA2APersistedMutationReceipts,
    stripA2APersistedArtifactMarkers,
    A2AClient: class MockA2AClient {
      constructor(...args: unknown[]) {
        mocks.a2aConstructor(...args);
      }

      send(...args: unknown[]) {
        return mocks.a2aSend(...args);
      }

      getTask(...args: unknown[]) {
        return mocks.a2aGetTask(...args);
      }
    },
    signA2AOrganizationToken: mocks.signA2AOrganizationToken,
    signA2AOrgMemberDelegationToken: mocks.signA2AOrgMemberDelegationToken,
    signA2AToken: mocks.signA2AToken,
    getGlobalA2ASecret: () => process.env.A2A_SECRET?.trim(),
    canonicalA2AAudience: mocks.canonicalA2AAudience,
  };
});

vi.mock("@agent-native/core/org", () => ({
  getOrgA2ASecret: mocks.getOrgA2ASecret,
  getOrgDomain: mocks.getOrgDomain,
}));

vi.mock("@agent-native/core/mcp-client", () => ({
  listRemoteServers: mocks.listRemoteServers,
  getMcpOAuthAccessToken: mocks.getMcpOAuthAccessToken,
  mcpToolCallWasNotSent: (error: unknown) =>
    error instanceof Error && error.name === "NotSentFixture",
  buildMcpToolName: (serverId: string, toolName: string) =>
    `mcp__${serverId}__${toolName}`,
  McpClientManager: class MockMcpClientManager {
    constructor(config: unknown) {
      mocks.managerConstructor(config);
    }

    start() {
      return mocks.managerStart();
    }

    getConnectErrorStatus(serverId: string) {
      return mocks.managerGetConnectErrorStatus(serverId);
    }

    stop() {
      return mocks.managerStop();
    }

    callTool(name: string, args: unknown) {
      return mocks.managerCallTool(name, args);
    }

    hasServer(serverId: string) {
      return mocks.managerHasServer(serverId);
    }

    getTool(name: string) {
      return mocks.managerGetTool(name);
    }

    getToolsForServer(serverId: string) {
      return mocks.managerGetToolsForServer(serverId);
    }
  },
}));

import { runWithRequestContext } from "@agent-native/core/server";

import askAppStatusAction from "../../actions/ask_app_status.js";
import {
  appHomeBaseUrl,
  callGrantedDispatchMcpAppAction,
  clearGrantedAppManifestCache,
  createGrantedDispatchMcpEmbedSession,
  createGrantedDispatchMcpEmbedSessionForWorkspaceAppChat,
  createWorkspaceSsoEmbedSession,
  createWorkspaceSsoEmbedSessionForWorkspaceAppChat,
  askGrantedDispatchMcpApp,
  getGrantedDispatchMcpAppTask,
  joinAppBaseUrlAndPath,
  listDispatchMcpApps,
  listGrantedDispatchMcpAppActions,
  listGrantedDispatchMcpApps,
  listGrantedDispatchMcpAppOrigins,
  openGrantedDispatchMcpApp,
  registerGrantedAppManifest,
  resolveGrantedDispatchMcpApp,
  setDispatchAppActionHeaderProvider,
} from "./mcp-gateway.js";

const analyticsAgent = {
  id: "analytics",
  name: "Analytics",
  description: "Dashboards and metrics",
  url: "http://localhost:8086",
  color: "#6366F1",
};

function withSignedMutationReceipts(
  text: string,
  receipts: unknown[],
  secret: string,
  delegatedTaskId: string,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      identities: [],
      mutationReceipts: receipts,
      delegatedTaskId,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${text}\n\n<!-- agent-native:persisted-artifacts=${payload}.${signature} -->`;
}

beforeEach(() => {
  resetAppConfigForTests();
  mocks.a2aConstructor.mockReset();
  mocks.a2aSend.mockReset();
  mocks.a2aGetTask.mockReset();
  mocks.signA2AOrganizationToken.mockReset();
  mocks.signA2AOrgMemberDelegationToken.mockReset();
  mocks.signA2AToken.mockReset();
  mocks.discoverAgents.mockResolvedValue([analyticsAgent]);
  mocks.directoryStatus.mockReturnValue({ status: "available" });
  mocks.getBuiltinAgents.mockReturnValue([]);
  mocks.listWorkspaceApps.mockResolvedValue([]);
  mocks.getUserSetting.mockResolvedValue({ mode: "all-apps" });
  mocks.getOrgSetting.mockResolvedValue({ mode: "all-apps" });
  mocks.createEmbedSessionTicket.mockResolvedValue({
    ticket: "ticket-123",
    ticketHash: "hash-123",
    expiresAt: 12345,
  });
  mocks.listRemoteServers.mockReset().mockResolvedValue([]);
  mocks.getMcpOAuthAccessToken.mockReset().mockResolvedValue(null);
  mocks.managerStart.mockResolvedValue(undefined);
  mocks.managerGetConnectErrorStatus.mockReturnValue(undefined);
  mocks.managerStop.mockResolvedValue(undefined);
  mocks.managerHasServer.mockReturnValue(true);
  mocks.managerGetTool.mockReturnValue({ name: "mcp__target__get-project" });
  mocks.managerGetToolsForServer.mockReturnValue([]);
  mocks.managerCallTool.mockResolvedValue({
    structuredContent: {
      startUrl: "http://localhost:8086/_agent-native/embed/start?ticket=remote",
    },
  });
  mocks.a2aSend.mockResolvedValue({
    id: "task-1",
    status: {
      state: "completed",
      message: {
        role: "agent",
        parts: [{ type: "text", text: "Created the requested dashboard." }],
      },
    },
  });
  mocks.signA2AToken.mockResolvedValue("signed-token");
  mocks.signA2AOrgMemberDelegationToken.mockResolvedValue("org-member-token");
  mocks.signA2AOrganizationToken.mockResolvedValue("signed-token");
  mocks.getOrgA2ASecret.mockResolvedValue(null);
  mocks.getOrgDomain.mockResolvedValue(null);
  vi.stubEnv("A2A_SECRET", "");
  vi.stubEnv("APP_URL", "http://localhost:8092");
  mocks.isFeatureFlagEnabled.mockResolvedValue(true);
});

afterEach(() => {
  resetAppConfigForTests();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Dispatch direct app actions", () => {
  const asOwner = <T>(work: () => Promise<T>) =>
    runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      work,
    );

  beforeEach(() => {
    vi.stubEnv("A2A_SECRET", "test-only-secret");
  });

  it("refuses before resolving any app while the capability is off", async () => {
    await expect(
      asOwner(() => listGrantedDispatchMcpAppActions("analytics")),
    ).rejects.toMatchObject({ errorCode: "direct_app_actions_disabled" });
    await expect(
      asOwner(() =>
        callGrantedDispatchMcpAppAction("analytics", "get-project", {}),
      ),
    ).rejects.toMatchObject({ errorCode: "direct_app_actions_disabled" });
    expect(mocks.discoverAgents).not.toHaveBeenCalled();
    expect(mocks.managerConstructor).not.toHaveBeenCalled();
  });

  it("lists a granted app's actions over a full-catalog user credential", async () => {
    defineAppConfig({ dispatch: { directAppActions: true } });
    mocks.managerGetToolsForServer.mockReturnValue([
      {
        originalName: "get-project",
        description: "Read one project. Includes its members and settings.",
        inputSchema: { type: "object" },
        annotations: { readOnlyHint: true },
      },
      {
        originalName: "create_embed_session",
        description: "Embed handshake.",
        inputSchema: { type: "object" },
      },
    ]);

    const actions = await asOwner(() =>
      listGrantedDispatchMcpAppActions("analytics"),
    );

    expect(actions).toEqual([
      { name: "get-project", description: "Read one project.", readOnly: true },
    ]);
    expect(mocks.signA2AToken).toHaveBeenCalledWith(
      "owner@example.test",
      undefined,
      undefined,
      expect.objectContaining({
        extraClaims: expect.objectContaining({ catalog_scope: "full" }),
      }),
    );
    expect(mocks.managerConstructor).toHaveBeenCalledWith({
      servers: {
        target: expect.objectContaining({
          url: "http://localhost:8086/mcp",
          headers: expect.objectContaining({
            Authorization: "Bearer signed-token",
          }),
        }),
      },
    });
    expect(mocks.managerStop).toHaveBeenCalled();
  });

  it("keeps a same-deployment assertion when it is accepted", async () => {
    defineAppConfig({ dispatch: { directAppActions: true } });
    mocks.discoverAgents.mockResolvedValue([
      { ...analyticsAgent, url: "http://localhost:8092/analytics" },
    ]);
    mocks.managerCallTool.mockResolvedValue({ content: [] });
    await asOwner(() =>
      callGrantedDispatchMcpAppAction("analytics", "get-project", {}),
    );
    expect(mocks.managerConstructor).toHaveBeenCalledWith({
      servers: {
        target: expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer signed-token",
          }),
        }),
      },
    });
    expect(mocks.listRemoteServers).not.toHaveBeenCalled();
  });

  it("keeps first-party assertion connections independent of the OAuth store", async () => {
    defineAppConfig({ dispatch: { directAppActions: true } });
    mocks.discoverAgents.mockResolvedValue([
      { ...analyticsAgent, url: "https://analytics.agent-native.com" },
    ]);
    mocks.listRemoteServers.mockRejectedValue(new Error("store unavailable"));
    mocks.managerCallTool.mockResolvedValue({ content: [] });
    await asOwner(() =>
      callGrantedDispatchMcpAppAction("analytics", "get-project", {}),
    );
    expect(mocks.managerConstructor).toHaveBeenCalledWith({
      servers: {
        target: expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer signed-token",
          }),
        }),
      },
    });
    expect(mocks.listRemoteServers).not.toHaveBeenCalled();
  });

  it("tries the scoped OAuth connection after a same-origin assertion is rejected", async () => {
    defineAppConfig({ dispatch: { directAppActions: true } });
    mocks.discoverAgents.mockResolvedValue([
      { ...analyticsAgent, url: "http://localhost:8092/analytics" },
    ]);
    mocks.listRemoteServers.mockResolvedValue([
      {
        id: "connection-1",
        name: "remote",
        url: "http://localhost:8092/analytics/mcp",
        oauthSecretKey: "oauth-key",
        createdAt: 1,
      },
    ]);
    mocks.getMcpOAuthAccessToken.mockResolvedValue("oauth-token");
    mocks.managerGetConnectErrorStatus
      .mockReturnValueOnce(401)
      .mockReturnValueOnce(undefined);
    mocks.managerCallTool.mockResolvedValue({ content: [] });
    await asOwner(() =>
      callGrantedDispatchMcpAppAction("analytics", "get-project", {}),
    );
    expect(mocks.managerConstructor).toHaveBeenCalledTimes(2);
    expect(mocks.managerConstructor).toHaveBeenLastCalledWith({
      servers: {
        target: expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer oauth-token",
          }),
        }),
      },
    });
  });

  it("uses a caller's OAuth connection for a different deployment", async () => {
    defineAppConfig({ dispatch: { directAppActions: true } });
    vi.stubEnv("A2A_SECRET", "");
    mocks.discoverAgents.mockResolvedValue([
      { ...analyticsAgent, url: "https://remote.example.test/app" },
    ]);
    mocks.listRemoteServers.mockResolvedValue([
      {
        id: "connection-1",
        name: "remote",
        url: "https://remote.example.test/app/mcp",
        oauthSecretKey: "oauth-key",
        createdAt: 1,
      },
    ]);
    mocks.getMcpOAuthAccessToken.mockResolvedValue("oauth-token");
    mocks.managerCallTool.mockResolvedValue({ content: [] });

    await asOwner(() =>
      callGrantedDispatchMcpAppAction("analytics", "get-project", {}),
    );
    expect(mocks.getMcpOAuthAccessToken).toHaveBeenCalledWith({
      key: "oauth-key",
      scope: "user",
      scopeId: "owner@example.test",
      serverUrl: "https://remote.example.test/app/mcp",
      throwOnTransientRefreshFailure: true,
    });
    expect(mocks.managerConstructor).toHaveBeenCalledWith({
      servers: {
        target: expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer oauth-token",
          }),
        }),
      },
    });
    expect(mocks.signA2AToken).not.toHaveBeenCalled();
  });

  it("returns a connect URL when an assertion is rejected and no OAuth connection exists", async () => {
    defineAppConfig({ dispatch: { directAppActions: true } });
    mocks.discoverAgents.mockResolvedValue([
      { ...analyticsAgent, url: "https://remote.example.test/app" },
    ]);
    mocks.managerGetConnectErrorStatus.mockReturnValue(401);
    const error = await asOwner(() =>
      callGrantedDispatchMcpAppAction("analytics", "get-project", {}),
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      errorCode: "authorization_required",
      details: { authorizationUrl: expect.any(String) },
    });
    const url = new URL(
      (error as { details: { authorizationUrl: string } }).details
        .authorizationUrl,
    );
    expect(url.pathname).toBe("/_agent-native/mcp/servers/oauth/start");
    expect(url.searchParams.get("url")).toBe(
      "https://remote.example.test/app/mcp",
    );
    expect(url.searchParams.get("scope")).toBe("user");
    expect(mocks.managerCallTool).not.toHaveBeenCalled();
  });

  it("offers reconnect when the saved credential needs authorization", async () => {
    defineAppConfig({ dispatch: { directAppActions: true } });
    mocks.discoverAgents.mockResolvedValue([
      { ...analyticsAgent, url: "https://remote.example.test/app" },
    ]);
    mocks.listRemoteServers.mockResolvedValue([
      {
        id: "connection-1",
        name: "remote",
        url: "https://remote.example.test/app/mcp",
        oauthSecretKey: "oauth-key",
        createdAt: 1,
      },
    ]);
    mocks.managerGetConnectErrorStatus.mockReturnValue(401);
    const error = await asOwner(() =>
      callGrantedDispatchMcpAppAction("analytics", "get-project", {}),
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ errorCode: "authorization_required" });
    const url = new URL(
      (error as { details: { authorizationUrl: string } }).details
        .authorizationUrl,
    );
    expect(url.searchParams.get("serverId")).toBe("connection-1");
  });

  it("does not report a connection-store failure as missing authorization", async () => {
    defineAppConfig({ dispatch: { directAppActions: true } });
    mocks.discoverAgents.mockResolvedValue([
      { ...analyticsAgent, url: "https://remote.example.test/app" },
    ]);
    mocks.listRemoteServers.mockRejectedValue(new Error("store unavailable"));
    await expect(
      asOwner(() =>
        callGrantedDispatchMcpAppAction("analytics", "get-project", {}),
      ),
    ).rejects.toMatchObject({ errorCode: "app_connection_unavailable" });
    expect(mocks.managerConstructor).not.toHaveBeenCalled();
  });

  it("does not reuse a different resource's OAuth token", async () => {
    defineAppConfig({ dispatch: { directAppActions: true } });
    mocks.discoverAgents.mockResolvedValue([
      { ...analyticsAgent, url: "https://remote.example.test/app" },
    ]);
    mocks.listRemoteServers.mockResolvedValue([
      {
        id: "other",
        name: "other",
        url: "https://remote.example.test/other/mcp",
        oauthSecretKey: "other-key",
        createdAt: 1,
      },
    ]);
    mocks.managerGetConnectErrorStatus.mockReturnValue(401);
    await expect(
      asOwner(() =>
        callGrantedDispatchMcpAppAction("analytics", "get-project", {}),
      ),
    ).rejects.toMatchObject({ errorCode: "authorization_required" });
    expect(mocks.getMcpOAuthAccessToken).not.toHaveBeenCalled();
  });

  it("distinguishes a rejected OAuth credential from an unreachable app", async () => {
    defineAppConfig({ dispatch: { directAppActions: true } });
    mocks.discoverAgents.mockResolvedValue([
      { ...analyticsAgent, url: "https://remote.example.test/app" },
    ]);
    mocks.listRemoteServers.mockResolvedValue([
      {
        id: "connection-1",
        name: "remote",
        url: "https://remote.example.test/app/mcp",
        oauthSecretKey: "oauth-key",
        createdAt: 1,
      },
    ]);
    mocks.getMcpOAuthAccessToken.mockResolvedValue("oauth-token");
    mocks.managerGetConnectErrorStatus.mockReturnValue(403);
    await expect(
      asOwner(() =>
        callGrantedDispatchMcpAppAction("analytics", "get-project", {}),
      ),
    ).rejects.toMatchObject({ errorCode: "app_connection_rejected" });
    mocks.managerGetConnectErrorStatus.mockReturnValue(undefined);
    mocks.managerHasServer.mockReturnValue(false);
    await expect(
      asOwner(() =>
        callGrantedDispatchMcpAppAction("analytics", "get-project", {}),
      ),
    ).rejects.toMatchObject({ errorCode: "app_connection_unreachable" });
  });

  it("calls one action of a granted app and returns its result", async () => {
    defineAppConfig({ dispatch: { directAppActions: true } });
    mocks.managerCallTool.mockResolvedValue({
      structuredContent: { id: "fixture" },
      content: [{ type: "text", text: '{"id":"fixture"}' }],
    });

    const result = await asOwner(() =>
      callGrantedDispatchMcpAppAction("analytics", "get-project", { id: "p" }),
    );

    expect(mocks.managerCallTool).toHaveBeenCalledWith(
      "mcp__target__get-project",
      { id: "p" },
    );
    expect(result).toEqual({
      structuredContent: { id: "fixture" },
      content: [{ type: "text", text: '{"id":"fixture"}' }],
    });
  });

  it("sends a deployment's per-call headers without letting them replace the credential", async () => {
    defineAppConfig({ dispatch: { directAppActions: true } });
    mocks.managerCallTool.mockResolvedValue({
      content: [{ type: "text", text: "{}" }],
    });
    const provider = vi.fn(() => ({ "x-agent-native-turn-grant": "grant-1" }));
    const remove = setDispatchAppActionHeaderProvider(provider);
    try {
      await asOwner(() =>
        callGrantedDispatchMcpAppAction("analytics", "get-project", {}),
      );
      expect(provider).toHaveBeenCalledWith({
        app: "analytics",
        action: "get-project",
        ownerEmail: "owner@example.test",
      });
      expect(mocks.managerConstructor).toHaveBeenCalledWith({
        servers: {
          target: expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: "Bearer signed-token",
              "x-agent-native-turn-grant": "grant-1",
            }),
          }),
        },
      });

      provider.mockReturnValue({ authorization: "Bearer other" } as never);
      await expect(
        asOwner(() =>
          callGrantedDispatchMcpAppAction("analytics", "get-project", {}),
        ),
      ).rejects.toThrow(/invalid "authorization" header/);
    } finally {
      remove();
    }
  });

  it("forwards the bound visible child tab on app actions", async () => {
    defineAppConfig({ dispatch: { directAppActions: true } });
    mocks.managerCallTool.mockResolvedValue({ content: [] });
    mocks.resolveChildBrowserTab.mockResolvedValueOnce(
      "fd88b908-c543-43a8-b044-425959511c70",
    );
    await asOwner(() =>
      callGrantedDispatchMcpAppAction("analytics", "view-screen", {}),
    );
    expect(mocks.resolveChildBrowserTab).toHaveBeenCalledWith(
      expect.objectContaining({ id: "analytics", url: analyticsAgent.url }),
    );
    expect(mocks.managerConstructor).toHaveBeenCalledWith({
      servers: {
        target: expect.objectContaining({
          headers: expect.objectContaining({
            "x-agent-native-browser-tab":
              "fd88b908-c543-43a8-b044-425959511c70",
          }),
        }),
      },
    });
  });

  it("refuses an app the caller has not granted", async () => {
    defineAppConfig({ dispatch: { directAppActions: true } });
    mocks.getUserSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["dispatch"],
    });

    await expect(
      asOwner(() =>
        callGrantedDispatchMcpAppAction("analytics", "get-project", {}),
      ),
    ).rejects.toThrow(/not granted/);
    await expect(
      asOwner(() => listGrantedDispatchMcpAppActions("analytics")),
    ).rejects.toThrow(/not granted/);
    expect(mocks.managerConstructor).not.toHaveBeenCalled();
  });

  it("rejects an unreadable upstream result rather than returning empty content", async () => {
    defineAppConfig({ dispatch: { directAppActions: true } });
    mocks.managerCallTool.mockResolvedValue({
      structuredContent: { id: "fixture" },
    });

    await expect(
      asOwner(() =>
        callGrantedDispatchMcpAppAction("analytics", "get-project", {}),
      ),
    ).rejects.toMatchObject({ errorCode: "app_action_result_unreadable" });
  });

  it("warns that a write may have landed when the upstream call throws", async () => {
    defineAppConfig({ dispatch: { directAppActions: true } });
    mocks.managerCallTool.mockRejectedValue(new Error("socket hang up"));

    const call = asOwner(() =>
      callGrantedDispatchMcpAppAction("analytics", "get-project", {}),
    );
    await expect(call).rejects.toMatchObject({
      errorCode: "app_action_outcome_unknown",
    });
    await expect(call).rejects.toThrow(/socket hang up.*inspect the app/);
  });

  it("tries the org-member fallback once when every credential is rejected", async () => {
    defineAppConfig({ dispatch: { directAppActions: true } });
    mocks.getOrgDomain.mockResolvedValue("builder.io");
    mocks.getOrgA2ASecret.mockResolvedValue("org-specific-secret");
    mocks.managerGetConnectErrorStatus.mockReturnValue(401);

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          orgId: "org-1",
          requestOrigin: "http://localhost:8092",
        },
        () => callGrantedDispatchMcpAppAction("analytics", "get-project", {}),
      ),
    ).rejects.toMatchObject({ errorCode: "authorization_required" });
    expect(mocks.signA2AOrgMemberDelegationToken).toHaveBeenCalledTimes(1);
    expect(mocks.managerConstructor).toHaveBeenCalledTimes(2);
    expect(mocks.managerCallTool).not.toHaveBeenCalled();
  });

  it("reports a refusal raised before sending as not run, not as an uncertain write", async () => {
    defineAppConfig({ dispatch: { directAppActions: true } });
    const refusal = Object.assign(new Error("Not authorized"), {
      name: "NotSentFixture",
      statusCode: 403,
    });
    mocks.managerCallTool.mockRejectedValue(refusal);

    const error = await asOwner(() =>
      callGrantedDispatchMcpAppAction("analytics", "get-project", {}),
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      errorCode: "app_action_not_sent",
      statusCode: 403,
    });
    expect((error as Error).message).toMatch(/did not run \(Not authorized\)/);
    expect((error as Error).message).not.toMatch(/outcome may be unknown/);
  });
});

describe("Dispatch MCP gateway app discovery", () => {
  it("resolves qualified workspace identities before display names and reports ties", async () => {
    const asOwner = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        fn,
      );
    mocks.discoverAgents.mockResolvedValue([
      { ...analyticsAgent, id: "fleet-2", name: "Fleet" },
      { ...analyticsAgent, id: "workspace/fleet", name: "Fleet" },
    ]);
    expect(
      (await asOwner(() => resolveGrantedDispatchMcpApp("workspace/fleet"))).id,
    ).toBe("workspace/fleet");
    expect(
      (await asOwner(() => resolveGrantedDispatchMcpApp("fleet"))).id,
    ).toBe("workspace/fleet");
    mocks.discoverAgents.mockResolvedValue([
      { ...analyticsAgent, id: "one/fleet", name: "Fleet" },
      { ...analyticsAgent, id: "two/fleet", name: "Fleet" },
    ]);
    await expect(
      asOwner(() => resolveGrantedDispatchMcpApp("fleet")),
    ).rejects.toThrow(/one\/fleet, two\/fleet/);
  });

  it("uses scoped directory manifests during an outage and rechecks current grants", async () => {
    const workspaceFleet = {
      ...analyticsAgent,
      id: "workspace/fleet",
      name: "Fleet",
      source: "org-directory",
      aliases: ["Delivery desk", "fleet-2"],
    };
    const templateFleet = {
      ...analyticsAgent,
      id: "fleet-2",
      name: "Fleet",
      source: "builtin",
    };
    const listFor = (
      orgId: string,
      userEmail = "directory-cache@example.test",
    ) =>
      runWithRequestContext(
        { userEmail, orgId, requestOrigin: "http://localhost:8092" },
        () => listDispatchMcpApps(),
      );
    mocks.discoverAgents.mockResolvedValue([workspaceFleet, templateFleet]);
    mocks.listWorkspaceApps.mockResolvedValue([
      { id: workspaceFleet.id, path: "/", url: workspaceFleet.url },
    ]);
    await listFor("directory-org");

    mocks.discoverAgents.mockResolvedValue([templateFleet]);
    mocks.directoryStatus.mockReturnValue({
      status: "unavailable",
      reason: "server-error",
    });
    const sameScope = await listFor("directory-org");
    expect(sameScope.degradedSources).toEqual([
      {
        source: "workspace-directory",
        status: "unavailable",
        usingCache: true,
      },
    ]);
    expect(sameScope.apps).toContainEqual(
      expect.objectContaining({
        id: "workspace/fleet",
        aliases: ["Delivery desk", "fleet-2"],
        granted: true,
      }),
    );
    const resolve = (app: string) =>
      runWithRequestContext(
        {
          userEmail: "directory-cache@example.test",
          orgId: "directory-org",
          requestOrigin: "http://localhost:8092",
        },
        () => resolveGrantedDispatchMcpApp(app),
      );
    await expect(resolve("fleet")).resolves.toMatchObject({
      id: "workspace/fleet",
    });
    await expect(resolve("Delivery desk")).resolves.toMatchObject({
      id: "workspace/fleet",
    });
    await expect(resolve("fleet-2")).resolves.toMatchObject({
      id: "fleet-2",
    });
    expect((await listFor("another-org")).apps.map((app) => app.id)).toEqual([
      "dispatch",
      "fleet-2",
    ]);
    expect(
      (await listFor("directory-org", "another-person@example.test")).apps.map(
        (app) => app.id,
      ),
    ).toEqual(["dispatch", "fleet-2"]);

    mocks.getOrgSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["fleet-2"],
    });
    await expect(resolve("workspace/fleet")).rejects.toThrow(/not granted/);
    expect((await listFor("directory-org")).apps).toContainEqual(
      expect.objectContaining({ id: "workspace/fleet", granted: false }),
    );

    mocks.listWorkspaceApps.mockResolvedValue([]);
    expect((await listFor("directory-org")).apps.map((app) => app.id)).toEqual([
      "dispatch",
      "fleet-2",
    ]);
    mocks.directoryStatus.mockReturnValue({ status: "forbidden" });
    expect((await listFor("directory-org")).apps.map((app) => app.id)).toEqual([
      "dispatch",
      "fleet-2",
    ]);
    mocks.directoryStatus.mockReturnValue({
      status: "unavailable",
      reason: "timeout",
    });
    expect((await listFor("directory-org")).degradedSources).toEqual([
      {
        source: "workspace-directory",
        status: "unavailable",
        usingCache: false,
      },
    ]);
  });

  it("rejects a previously registered runtime when its mount can no longer be verified", async () => {
    const id = "cached-workspace-app";
    const url = "https://beta.agent-workspace.builder.io";
    const request = {
      userEmail: "mount-cache@example.test",
      orgId: "mount-cache-org",
      requestOrigin: "https://beta.dispatch.agent-native.com",
    };
    mocks.discoverAgents.mockResolvedValue([
      { ...analyticsAgent, id, url: `${url}/dispatch/apps/${id}` },
    ]);
    mocks.listWorkspaceApps.mockResolvedValue([
      { id, path: "/actual-mount", url: `${url}/actual-mount` },
    ]);
    const open = () =>
      runWithRequestContext(request, () => resolveGrantedDispatchMcpApp(id));
    await expect(open()).resolves.toMatchObject({
      homeUrl: `${url}/actual-mount`,
    });
    mocks.listWorkspaceApps.mockRejectedValue({ statusCode: 503 });

    await expect(open()).rejects.toThrow(/mount resolves/);
    const result = await runWithRequestContext(request, listDispatchMcpApps);
    expect(result.degradedSources).toEqual([
      {
        source: "workspace-mounts",
        status: "unavailable",
        httpStatus: 503,
        usingCache: false,
      },
    ]);
  });

  it("keeps last-known remote manifests when strict connected discovery fails", async () => {
    const request = {
      userEmail: "strict-discovery@example.test",
      orgId: "strict-discovery-org",
      requestOrigin: "http://localhost:8092",
    };
    const read = () => runWithRequestContext(request, listDispatchMcpApps);
    mocks.discoverAgents.mockResolvedValue([
      { ...analyticsAgent, id: "remote/project", source: "remote-agent" },
    ]);
    mocks.listWorkspaceApps.mockResolvedValue([
      { id: "remote/project", path: "/", url: analyticsAgent.url },
    ]);
    await read();
    expect(mocks.discoverAgents).toHaveBeenCalledWith("dispatch", {
      requireReadableAgentSources: true,
    });

    mocks.discoverAgents.mockRejectedValue(new Error("directory unavailable"));
    const result = await read();
    expect(result.apps.map((app) => app.id)).toEqual([
      "dispatch",
      "remote/project",
    ]);
    expect(result.degradedSources).toEqual([
      { source: "connected-apps", status: "unavailable", usingCache: true },
    ]);

    mocks.discoverAgents.mockRejectedValue(
      new Error("Unable to read connected agent resources", {
        cause: Object.assign(new Error("Access denied"), { status: 403 }),
      }),
    );
    const denied = await read();
    expect(denied.apps.map((app) => app.id)).toEqual(["dispatch"]);
    expect(denied.degradedSources).toEqual([
      {
        source: "connected-apps",
        status: "forbidden",
        usingCache: false,
        httpStatus: 403,
      },
    ]);
  });

  it("lists a discovered app without a description as an empty description", async () => {
    const { description: _omitted, ...agent } = analyticsAgent;
    mocks.discoverAgents.mockResolvedValue([agent]);

    const { apps } = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => listDispatchMcpApps(),
    );

    expect(apps.find((app) => app.id === "analytics")?.description).toBe("");
  });

  it("reports a mounted discovery failure while keeping other apps available", async () => {
    mocks.listWorkspaceApps.mockRejectedValue({ status: 503 });

    const { apps, degradedSources } = await runWithRequestContext(
      {
        userEmail: "discovery-unavailable@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => listDispatchMcpApps(),
    );

    expect(apps.map((app) => app.id)).toEqual(["dispatch", "analytics"]);
    expect(degradedSources).toEqual([
      {
        source: "workspace-mounts",
        status: "unavailable",
        usingCache: false,
        httpStatus: 503,
      },
    ]);
  });

  it("refuses a Workspace app on its Dispatch page URL while the mounted lookup is unavailable", async () => {
    mocks.listWorkspaceApps.mockRejectedValue({ status: 503 });
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
        color: "#6366F1",
      },
    ]);

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "https://beta.dispatch.agent-native.com",
        },
        () => resolveGrantedDispatchMcpApp("customer-ticket-triage"),
      ),
    ).rejects.toThrow(
      'Dispatch MCP app "customer-ticket-triage" is unavailable until its Workspace mount resolves.',
    );
  });

  it("keeps Dispatch-page apps out of the granted list while the mounted lookup is unavailable", async () => {
    mocks.listWorkspaceApps.mockRejectedValue({ status: 503 });
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
        color: "#6366F1",
      },
    ]);

    const apps = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://beta.dispatch.agent-native.com",
      },
      () => listGrantedDispatchMcpApps(),
    );

    expect(apps.map((app) => app.id)).toEqual(["dispatch"]);
  });

  it("refuses a Dispatch-page app whose mounted path is invalid", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
        color: "#6366F1",
      },
    ]);
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        path: "//evil.example",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
        isDispatch: false,
      },
    ]);

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "https://beta.dispatch.agent-native.com",
        },
        () => resolveGrantedDispatchMcpApp("customer-ticket-triage"),
      ),
    ).rejects.toThrow(
      'Dispatch MCP app "customer-ticket-triage" is unavailable until its Workspace mount resolves.',
    );
  });

  it("builds open_app links from the mounted Workspace app path", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
        color: "#6366F1",
      },
    ]);
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        path: "/customer-ticket-triage",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
        isDispatch: false,
      },
    ]);

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://beta.dispatch.agent-native.com",
      },
      () =>
        openGrantedDispatchMcpApp({
          app: "customer-ticket-triage",
          path: "/triage",
        }),
    );

    expect(result.url).toBe(
      "https://beta.agent-workspace.builder.io/customer-ticket-triage/triage",
    );
  });

  it("opens an app's home when only the app is named", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
        color: "#6366F1",
      },
    ]);
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        path: "/customer-ticket-triage",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
        isDispatch: false,
      },
    ]);

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://beta.dispatch.agent-native.com",
      },
      () => openGrantedDispatchMcpApp({ app: "customer-ticket-triage" }),
    );

    expect(result.url).toBe(
      "https://beta.agent-workspace.builder.io/customer-ticket-triage/",
    );
  });

  it("keeps Dispatch-page apps out of the granted list when the registry omits them", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
        color: "#6366F1",
      },
    ]);
    mocks.listWorkspaceApps.mockResolvedValue([]);

    const apps = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://beta.dispatch.agent-native.com",
      },
      () => listGrantedDispatchMcpApps(),
    );

    expect(apps.map((app) => app.id)).toEqual(["dispatch"]);
  });

  it("does not route Workspace chat to a Dispatch-page app with an invalid mounted path", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
        color: "#6366F1",
      },
    ]);
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        path: "//evil.example",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
        isDispatch: false,
      },
    ]);

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          identityAuthenticatedAtMs: Date.now() - 1000,
          requestOrigin: "https://beta.dispatch.agent-native.com",
        },
        () =>
          createWorkspaceSsoEmbedSessionForWorkspaceAppChat(
            "customer-ticket-triage",
          ),
      ),
    ).rejects.toThrow();
    expect(mocks.managerCallTool).not.toHaveBeenCalled();
  });

  it("refuses a Dispatch-page app whose mount is on a different origin", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
        color: "#6366F1",
      },
    ]);
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        path: "/customer-ticket-triage",
        url: "https://other.example.test/dispatch/apps/customer-ticket-triage",
        isDispatch: false,
      },
    ]);

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "https://beta.dispatch.agent-native.com",
        },
        () => resolveGrantedDispatchMcpApp("customer-ticket-triage"),
      ),
    ).rejects.toThrow(
      'Dispatch MCP app "customer-ticket-triage" is unavailable until its Workspace mount resolves.',
    );
  });

  it("looks up the Workspace registry once when opening an app with an embed", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
        color: "#6366F1",
      },
    ]);
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        path: "/customer-ticket-triage",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
        isDispatch: false,
      },
    ]);

    await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://beta.dispatch.agent-native.com",
      },
      () =>
        openGrantedDispatchMcpApp({
          app: "customer-ticket-triage",
          path: "/triage",
          embed: true,
        }),
    );

    expect(mocks.listWorkspaceApps).toHaveBeenCalledTimes(1);
  });

  it("keeps a prefixed Dispatch app page out of the granted list when a base path is configured", async () => {
    const previous = process.env.APP_BASE_PATH;
    process.env.APP_BASE_PATH = "/prefix";
    try {
      mocks.discoverAgents.mockResolvedValue([
        {
          id: "customer-ticket-triage",
          name: "Customer Ticket Triage",
          description: "Triage customer tickets",
          url: "https://beta.agent-workspace.builder.io/prefix/dispatch/apps/customer-ticket-triage",
          color: "#6366F1",
        },
      ]);
      mocks.listWorkspaceApps.mockRejectedValue({ status: 503 });

      const apps = await runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "https://beta.dispatch.agent-native.com",
        },
        () => listGrantedDispatchMcpApps(),
      );

      expect(apps.map((app) => app.id)).toEqual(["dispatch"]);
    } finally {
      if (previous === undefined) delete process.env.APP_BASE_PATH;
      else process.env.APP_BASE_PATH = previous;
    }
  });

  it("defaults to exposing every discovered app", async () => {
    mocks.getUserSetting.mockResolvedValue(null);
    const apps = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => listGrantedDispatchMcpApps(),
    );

    expect(apps.map((app) => app.id)).toEqual(["dispatch", "analytics"]);
  });

  it("projects first-party app URLs onto the beta request lane", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        ...analyticsAgent,
        url: "https://analytics.agent-native.com",
      },
    ]);

    const apps = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://beta.dispatch.agent-native.com",
      },
      () => listGrantedDispatchMcpApps(),
    );

    expect(apps.find((app) => app.id === "analytics")?.url).toBe(
      "https://beta.analytics.agent-native.com/",
    );
  });

  it("projects the workspace Netlify alias onto the beta request lane", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        ...analyticsAgent,
        id: "cs-account-health",
        name: "CS Account Health",
        url: "https://builder-agent-native-workspace.netlify.app/cs-account-health",
      },
    ]);

    const apps = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://beta.dispatch.agent-native.com",
      },
      () => listGrantedDispatchMcpApps(),
    );

    expect(apps.find((app) => app.id === "cs-account-health")?.url).toBe(
      "https://beta.agent-workspace.builder.io/cs-account-health",
    );
  });

  it("includes Dispatch itself so agents can target extension routes", async () => {
    mocks.getUserSetting.mockResolvedValue({ mode: "all-apps" });
    const apps = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => listGrantedDispatchMcpApps(),
    );

    expect(apps.map((app) => app.id)).toEqual(["dispatch", "analytics"]);
    expect(apps[0]).toMatchObject({
      id: "dispatch",
      name: "Dispatch",
      url: "http://localhost:8092",
      granted: true,
    });
  });

  it("honors selected app grants for the Dispatch self target", async () => {
    mocks.getUserSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["dispatch"],
    });

    const apps = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => listGrantedDispatchMcpApps(),
    );

    expect(apps.map((app) => app.id)).toEqual(["dispatch"]);
  });

  it("returns deduped origins for granted Dispatch MCP apps only", async () => {
    mocks.discoverAgents.mockResolvedValue([
      analyticsAgent,
      {
        ...analyticsAgent,
        id: "analytics-copy",
        name: "Analytics Copy",
      },
      {
        id: "mail",
        name: "Mail",
        description: "Mail",
        url: "https://mail.agent-native.com/inbox",
        color: "#2563EB",
      },
      {
        id: "bad-url",
        name: "Bad URL",
        description: "Invalid manifest URL",
        url: "mail.agent-native.com",
        color: "#111827",
      },
      {
        id: "file-url",
        name: "File URL",
        description: "Unsupported manifest URL scheme",
        url: "file:///tmp/app",
        color: "#111827",
      },
    ]);
    mocks.getUserSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["dispatch", "analytics", "mail", "bad-url", "file-url"],
    });

    const origins = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => listGrantedDispatchMcpAppOrigins(),
    );
    const apps = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => listGrantedDispatchMcpApps(),
    );

    expect(origins).toEqual([
      "http://localhost:8092",
      "http://localhost:8086",
      "https://mail.agent-native.com",
    ]);
    expect(apps.map((app) => app.id)).toEqual([
      "dispatch",
      "analytics",
      "mail",
    ]);
  });

  it("rejects malformed granted app URLs before routing MCP actions", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "bad-url",
        name: "Bad URL",
        description: "Invalid manifest URL",
        url: "mail.agent-native.com",
        color: "#111827",
      },
    ]);
    mocks.getUserSetting.mockResolvedValue({ mode: "all-apps" });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () => resolveGrantedDispatchMcpApp("bad-url"),
      ),
    ).rejects.toThrow(/invalid URL/);
  });
});

describe("askGrantedDispatchMcpApp", () => {
  it("routes the authenticated user and active org identity to the granted app", async () => {
    mocks.getOrgSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["analytics"],
    });
    mocks.getOrgDomain.mockResolvedValue("builder.io");
    mocks.getOrgA2ASecret.mockResolvedValue("org-specific-secret");

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        askGrantedDispatchMcpApp(
          "analytics",
          "Build a weekly active users dashboard.",
        ),
    );

    expect(mocks.a2aConstructor).toHaveBeenCalledWith(
      "http://localhost:8086",
      "signed-token",
      { requestTimeoutMs: 10_000 },
    );
    expect(mocks.signA2AOrganizationToken).toHaveBeenCalledWith(
      "builder.io",
      "org-specific-secret",
      undefined,
      { audience: "http://localhost:8086" },
    );
    expect(mocks.a2aSend).toHaveBeenCalledWith(
      {
        role: "user",
        parts: [
          { type: "text", text: "Build a weekly active users dashboard." },
        ],
      },
      expect.objectContaining({
        async: true,
        deadlineMs: expect.any(Number),
        idempotencyKey: expect.stringMatching(/^ask-app:/),
        metadata: {
          userEmail: "owner@example.test",
          orgDomain: "builder.io",
          requestOrigin: "http://localhost:8092",
        },
      }),
    );
    expect(result).toMatchObject({
      app: "analytics",
      routedVia: "a2a",
      response: "Created the requested dashboard.",
      taskId: "task-1",
      status: "completed",
    });
  });

  it("does not sign an unscoped A2A user token when the active org domain is unavailable", async () => {
    vi.stubEnv("A2A_SECRET", "shared-a2a-secret");

    await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-without-domain",
        requestOrigin: "http://localhost:8092",
      },
      () => askGrantedDispatchMcpApp("analytics", "Build a dashboard."),
    );

    expect(mocks.signA2AToken).not.toHaveBeenCalled();
    expect(mocks.signA2AOrganizationToken).not.toHaveBeenCalled();
    expect(mocks.a2aConstructor).toHaveBeenCalledWith(
      "http://localhost:8086",
      undefined,
      { requestTimeoutMs: 10_000 },
    );
  });

  it("reuses the MCP request identity for transport retries", async () => {
    const requestContext = {
      userEmail: "owner@example.test",
      orgId: "org-1",
      requestOrigin: "http://localhost:8092",
      mcpRequestId: "session-1:request-42",
    };

    await runWithRequestContext(requestContext, () =>
      askGrantedDispatchMcpApp("analytics", "Retry this request.", {
        async: true,
      }),
    );
    await runWithRequestContext(requestContext, () =>
      askGrantedDispatchMcpApp("analytics", "Retry this request.", {
        async: true,
      }),
    );

    const firstKey = mocks.a2aSend.mock.calls[0]?.[1].idempotencyKey;
    const secondKey = mocks.a2aSend.mock.calls[1]?.[1].idempotencyKey;
    expect(firstKey).toMatch(/^ask-app:v1:[0-9a-f]{64}$/);
    expect(secondKey).toBe(firstKey);
  });

  it("preserves authenticated structured mutation receipts from the target app", async () => {
    const orgSecret = "org-receipt-secret";
    mocks.getOrgA2ASecret.mockResolvedValueOnce(orgSecret);
    mocks.discoverAgents.mockResolvedValueOnce([
      { ...analyticsAgent, id: "content", name: "Content" },
    ]);
    const receipt = {
      receiptId: "receipt-row-1",
      sourceAction: "upsert-database-item-by-key",
      operation: "upsert",
      outcome: "updated",
      target: {
        authorityScopeKind: "personal",
        authorityScopeId: "owner@example.test",
        spaceId: "space-owner",
        databaseId: "feedback-db",
        databaseDocumentId: "feedback-db-document",
      },
      row: {
        itemId: "feedback-item-1",
        documentId: "feedback-document-1",
        urlPath: "/page/feedback-document-1",
      },
      idempotency: {
        key: "request-1",
        result: "replayed",
        payloadDigest: "digest-1",
      },
      revisions: { before: "before", after: "after" },
      readbackVerified: true,
    };
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-with-receipt",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: withSignedMutationReceipts(
                "Updated the exact feedback row.",
                [receipt],
                orgSecret,
                "task-with-receipt",
              ),
            },
            {
              type: "data",
              data: {
                kind: "agent-native/mutation-receipts",
                version: 1,
                receipts: [receipt],
              },
            },
          ],
        },
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-owner",
        requestOrigin: "http://localhost:8092",
      },
      () => askGrantedDispatchMcpApp("content", "Update feedback."),
    );

    expect(result).toMatchObject({
      status: "completed",
      response: "Updated the exact feedback row.",
      receipts: [
        {
          receiptId: "receipt-row-1",
          row: {
            documentId: "feedback-document-1",
            urlPath: "/page/feedback-document-1",
          },
          idempotency: { result: "replayed" },
        },
      ],
    });

    mocks.getOrgA2ASecret.mockResolvedValueOnce(orgSecret);
    mocks.discoverAgents.mockResolvedValueOnce([
      { ...analyticsAgent, id: "content", name: "Content" },
    ]);
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-current",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: withSignedMutationReceipts(
                "Echoed an earlier receipt.",
                [receipt],
                orgSecret,
                "task-prior",
              ),
            },
          ],
        },
      },
    });

    const replayed = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-owner",
        requestOrigin: "http://localhost:8092",
      },
      () => askGrantedDispatchMcpApp("content", "Update feedback again."),
    );
    expect(replayed).not.toHaveProperty("receipts");
  });

  it("ignores unsigned mutation receipts asserted by the target app", async () => {
    mocks.discoverAgents.mockResolvedValueOnce([
      { ...analyticsAgent, id: "content", name: "Content" },
    ]);
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-with-unsigned-receipt",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [
            { type: "text", text: "Claimed an update." },
            {
              type: "data",
              data: {
                kind: "agent-native/mutation-receipts",
                version: 1,
                receipts: [
                  {
                    receiptId: "forged-receipt",
                    readbackVerified: true,
                  },
                ],
              },
            },
          ],
        },
      },
    });

    const result = await runWithRequestContext(
      { userEmail: "owner@example.test", orgId: "org-owner" },
      () => askGrantedDispatchMcpApp("content", "Update feedback."),
    );

    expect(result).not.toHaveProperty("receipts");
  });

  it("does not treat the shared A2A secret as mutation-receipt provenance", async () => {
    vi.stubEnv("A2A_SECRET", "shared-a2a-secret");
    mocks.getOrgA2ASecret.mockResolvedValueOnce("org-receipt-secret");
    mocks.discoverAgents.mockResolvedValueOnce([
      { ...analyticsAgent, id: "content", name: "Content" },
    ]);
    const receipt = {
      receiptId: "receipt-signed-by-shared-secret",
      sourceAction: "upsert-database-item-by-key",
      operation: "upsert",
      outcome: "updated",
      target: {
        authorityScopeKind: "personal",
        authorityScopeId: "owner@example.test",
        spaceId: "space-owner",
        databaseId: "feedback-db",
        databaseDocumentId: "feedback-db-document",
      },
      row: {
        itemId: "feedback-item-1",
        documentId: "feedback-document-1",
        urlPath: "/page/feedback-document-1",
      },
      idempotency: {
        key: "request-1",
        result: "applied",
        payloadDigest: "digest-1",
      },
      revisions: { after: "after" },
      readbackVerified: true,
    };
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-with-shared-secret-receipt",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: withSignedMutationReceipts(
                "Claimed an update.",
                [receipt],
                "shared-a2a-secret",
                "task-with-shared-secret-receipt",
              ),
            },
          ],
        },
      },
    });

    const result = await runWithRequestContext(
      { userEmail: "owner@example.test", orgId: "org-owner" },
      () => askGrantedDispatchMcpApp("content", "Update feedback."),
    );

    expect(result).not.toHaveProperty("receipts");
  });

  it("ignores signed mutation receipts outside the authenticated principal scope", async () => {
    const orgSecret = "org-receipt-secret";
    mocks.getOrgA2ASecret.mockResolvedValueOnce(orgSecret);
    mocks.discoverAgents.mockResolvedValueOnce([
      { ...analyticsAgent, id: "content", name: "Content" },
    ]);
    const receipt = {
      receiptId: "receipt-other-owner",
      sourceAction: "upsert-database-item-by-key",
      operation: "upsert",
      outcome: "updated",
      target: {
        authorityScopeKind: "personal",
        authorityScopeId: "other@example.test",
        spaceId: "space-other",
        databaseId: "feedback-db",
        databaseDocumentId: "feedback-db-document",
      },
      row: {
        itemId: "feedback-item-1",
        documentId: "feedback-document-1",
        urlPath: "/page/feedback-document-1",
      },
      idempotency: {
        key: "request-1",
        result: "applied",
        payloadDigest: "digest-1",
      },
      revisions: { after: "after" },
      readbackVerified: true,
    };
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-with-wrong-scope-receipt",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: withSignedMutationReceipts(
                "Claimed an update.",
                [receipt],
                orgSecret,
                "task-with-wrong-scope-receipt",
              ),
            },
          ],
        },
      },
    });

    const result = await runWithRequestContext(
      { userEmail: "owner@example.test", orgId: "org-owner" },
      () => askGrantedDispatchMcpApp("content", "Update feedback."),
    );

    expect(result.response).toBe("Claimed an update.");
    expect(result).not.toHaveProperty("receipts");
  });

  it("returns a durable polling handle when the downstream task is still working", async () => {
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-working",
      status: { state: "working" },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        askGrantedDispatchMcpApp("analytics", "Build the report.", {
          async: true,
        }),
    );

    expect(result).toEqual({
      app: "analytics",
      routedVia: "a2a",
      taskId: "task-working",
      taskHandle: expect.stringMatching(
        /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
      ),
      status: "working",
      pollAfterMs: 1_500,
      poll: {
        tool: "ask_app_status",
        arguments: {
          app: "analytics",
          taskId: "task-working",
          taskHandle: result.taskHandle,
        },
      },
      message:
        'ask_app is still working. Call ask_app_status with taskId "task-working" and the returned taskHandle to retrieve the final response.',
    });
    expect(mocks.a2aSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        async: true,
        deadlineMs: expect.any(Number),
        idempotencyKey: expect.stringMatching(/^ask-app:/),
      }),
    );
  });

  it("counts submission and every poll against one inline deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mocks.a2aSend.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                id: "task-deadline",
                status: { state: "working" },
              }),
            3_000,
          );
        }),
    );
    mocks.a2aGetTask.mockImplementationOnce(() => new Promise(() => undefined));

    const resultPromise = runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        askGrantedDispatchMcpApp("analytics", "Build the report.", {
          maxWaitMs: 5_000,
        }),
    );

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(resultPromise).resolves.toMatchObject({
      taskId: "task-deadline",
      status: "working",
      pollAfterMs: 1_500,
    });
    expect(Date.now()).toBe(5_000);
    expect(mocks.a2aConstructor).toHaveBeenCalledWith(
      "http://localhost:8086",
      undefined,
      { requestTimeoutMs: 5_000 },
    );
    expect(mocks.a2aGetTask).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404])(
    "surfaces permanent %s status errors without waiting until the deadline",
    async (statusCode) => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      mocks.a2aSend.mockResolvedValueOnce({
        id: "task-missing",
        status: { state: "working" },
      });
      mocks.a2aGetTask.mockRejectedValueOnce(
        new Error(`A2A request failed (${statusCode}): Task not found`),
      );

      const resultPromise = runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          askGrantedDispatchMcpApp("analytics", "Build the report.", {
            maxWaitMs: 20_000,
          }),
      );
      const rejection = resultPromise.catch((err) => err);

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1_500);

      await expect(rejection).resolves.toEqual(
        expect.objectContaining({
          message: expect.stringMatching(
            new RegExp(`${statusCode}.*not found`, "i"),
          ),
        }),
      );
      expect(Date.now()).toBe(1_500);
      expect(mocks.a2aGetTask).toHaveBeenCalledTimes(1);
    },
  );

  it("retries transient status failures within the same deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-transient",
      status: { state: "working" },
    });
    mocks.a2aGetTask
      .mockRejectedValueOnce(new Error("A2A request failed (503): retry"))
      .mockResolvedValueOnce({
        id: "task-transient",
        status: {
          state: "completed",
          message: {
            role: "agent",
            parts: [{ type: "text", text: "The report is ready." }],
          },
        },
      });

    const resultPromise = runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        askGrantedDispatchMcpApp("analytics", "Build the report.", {
          maxWaitMs: 20_000,
        }),
    );

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(resultPromise).resolves.toMatchObject({
      taskId: "task-transient",
      status: "completed",
      response: "The report is ready.",
    });
    expect(mocks.a2aGetTask).toHaveBeenCalledTimes(2);
  });

  it("returns input-required as a terminal handoff instead of a poll loop", async () => {
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-input",
      status: {
        state: "input-required",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "Which date range should I use?" }],
        },
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => askGrantedDispatchMcpApp("analytics", "Build the report."),
    );

    expect(result).toEqual({
      app: "analytics",
      routedVia: "a2a",
      taskId: "task-input",
      status: "input-required",
      response: "Which date range should I use?",
      inputRequired: "Which date range should I use?",
      message: "Which date range should I use?",
    });
    expect(mocks.a2aGetTask).not.toHaveBeenCalled();
  });

  it("polls a granted app task through the same authenticated A2A route", async () => {
    mocks.a2aGetTask.mockResolvedValueOnce({
      id: "task-working",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "The report is ready." }],
        },
      },
    });
    mocks.getUserSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["analytics"],
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => getGrantedDispatchMcpAppTask("analytics", "task-working"),
    );

    expect(mocks.a2aGetTask).toHaveBeenCalledWith("task-working");
    expect(result).toEqual({
      app: "analytics",
      routedVia: "a2a",
      taskId: "task-working",
      status: "completed",
      response: "The report is ready.",
    });
  });

  it("returns a recoverable envelope when transient task status reads exhaust retries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.a2aGetTask.mockRejectedValue(new TypeError("fetch failed"));

    const resultPromise = runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () => getGrantedDispatchMcpAppTask("analytics", "task-unavailable"),
    );

    await vi.advanceTimersByTimeAsync(2_500);

    await expect(resultPromise).resolves.toMatchObject({
      app: "analytics",
      routedVia: "a2a",
      taskId: "task-unavailable",
      status: "unknown",
      statusRead: "unavailable",
      retryable: true,
      errorCategory: "transport",
      attempts: 4,
      pollAfterMs: 1_500,
      poll: {
        tool: "ask_app_status",
        arguments: { app: "analytics", taskId: "task-unavailable" },
      },
      message: expect.stringMatching(
        /status could not be read.*may still be running or completed.*retry.*ask_app_status.*do not resubmit ask_app/i,
      ),
    });
    expect(mocks.a2aGetTask).toHaveBeenCalledTimes(4);
    expect(mocks.a2aSend).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(4);
    expect(warnSpy).toHaveBeenLastCalledWith(
      "[ask_app_status] tasks/get attempt failed",
      expect.objectContaining({
        app: "analytics",
        routedVia: "a2a",
        taskId: "task-unavailable",
        originHost: "localhost:8086",
        attempt: 4,
        maxAttempts: 4,
        errorCategory: "transport",
        errorName: "TypeError",
        willRetry: false,
      }),
    );
  });

  it("does not retry permanent task status read errors", async () => {
    mocks.a2aGetTask.mockRejectedValueOnce(
      new Error("A2A request failed (404): Task not found"),
    );

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () => getGrantedDispatchMcpAppTask("analytics", "task-missing"),
      ),
    ).rejects.toThrow(/404.*task not found/i);
    expect(mocks.a2aGetTask).toHaveBeenCalledTimes(1);
    expect(mocks.a2aSend).not.toHaveBeenCalled();
  });

  it("rejects delegation to an app outside the grant", async () => {
    mocks.getUserSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["dispatch"],
    });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () => askGrantedDispatchMcpApp("analytics", "Show signups."),
      ),
    ).rejects.toThrow(/not granted/);
    expect(mocks.a2aSend).not.toHaveBeenCalled();
  });

  it("rejects polling a task for an app outside the grant", async () => {
    mocks.getUserSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["dispatch"],
    });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () => getGrantedDispatchMcpAppTask("analytics", "task-working"),
      ),
    ).rejects.toThrow(/not granted/);
    expect(mocks.a2aGetTask).not.toHaveBeenCalled();
  });

  it("polls the original sealed route with a valid taskHandle even after discovery drifts", async () => {
    vi.stubEnv("A2A_SECRET", "sealed-handle-secret");
    mocks.getOrgSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["analytics"],
    });
    mocks.getOrgDomain.mockResolvedValue("builder.io");
    mocks.getOrgA2ASecret.mockResolvedValue("org-specific-secret");
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-sealed-route",
      status: { state: "working" },
    });

    const submitted = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        askGrantedDispatchMcpApp("analytics", "Run cohort analysis.", {
          async: true,
        }),
    );

    expect(submitted.taskHandle).toMatch(/^v1\./);
    expect(submitted.poll).toEqual({
      tool: "ask_app_status",
      arguments: {
        app: "analytics",
        taskId: "task-sealed-route",
        taskHandle: submitted.taskHandle,
      },
    });

    mocks.discoverAgents.mockReset();
    mocks.discoverAgents.mockResolvedValue([
      { ...analyticsAgent, url: "http://localhost:9999" },
    ]);
    mocks.a2aConstructor.mockClear();
    mocks.a2aGetTask.mockResolvedValueOnce({
      id: "task-sealed-route",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "Cohort analysis complete." }],
        },
      },
    });

    const polled = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        getGrantedDispatchMcpAppTask("analytics", "task-sealed-route", {
          taskHandle: submitted.taskHandle,
        }),
    );

    expect(mocks.discoverAgents).not.toHaveBeenCalled();
    expect(mocks.a2aConstructor).toHaveBeenCalledWith(
      "http://localhost:8086",
      "signed-token",
      expect.objectContaining({ requestTimeoutMs: 10_000 }),
    );
    expect(mocks.a2aGetTask).toHaveBeenCalledWith("task-sealed-route");
    expect(polled).toEqual({
      app: "analytics",
      routedVia: "a2a",
      taskId: "task-sealed-route",
      status: "completed",
      response: "Cohort analysis complete.",
    });
  });

  it("preserves taskHandle across continued pending polls and statusRead unavailable envelopes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubEnv("A2A_SECRET", "sealed-handle-secret");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-long",
      status: { state: "working" },
    });

    const submitted = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        askGrantedDispatchMcpApp("analytics", "Generate quarterly rollup.", {
          async: true,
        }),
    );

    mocks.a2aGetTask.mockResolvedValueOnce({
      id: "task-long",
      status: { state: "working" },
    });
    const stillWorking = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        getGrantedDispatchMcpAppTask("analytics", "task-long", {
          taskHandle: submitted.taskHandle,
        }),
    );

    expect(stillWorking).toMatchObject({
      app: "analytics",
      taskId: "task-long",
      taskHandle: submitted.taskHandle,
      status: "working",
      poll: {
        tool: "ask_app_status",
        arguments: {
          app: "analytics",
          taskId: "task-long",
          taskHandle: submitted.taskHandle,
        },
      },
    });

    mocks.a2aGetTask.mockRejectedValue(new TypeError("fetch failed"));
    const unavailablePromise = runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        getGrantedDispatchMcpAppTask("analytics", "task-long", {
          taskHandle: submitted.taskHandle,
        }),
    );
    await vi.advanceTimersByTimeAsync(2_500);

    await expect(unavailablePromise).resolves.toMatchObject({
      app: "analytics",
      taskId: "task-long",
      taskHandle: submitted.taskHandle,
      status: "unknown",
      statusRead: "unavailable",
      poll: {
        tool: "ask_app_status",
        arguments: {
          app: "analytics",
          taskId: "task-long",
          taskHandle: submitted.taskHandle,
        },
      },
    });
  });

  it("denies a valid taskHandle when the app grant is revoked before polling", async () => {
    vi.stubEnv("A2A_SECRET", "sealed-handle-secret");
    mocks.getUserSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["analytics"],
    });
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-revoked",
      status: { state: "working" },
    });

    const submitted = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        askGrantedDispatchMcpApp("analytics", "Run private export.", {
          async: true,
        }),
    );

    mocks.getUserSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["dispatch"],
    });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          getGrantedDispatchMcpAppTask("analytics", "task-revoked", {
            taskHandle: submitted.taskHandle,
          }),
      ),
    ).rejects.toThrow(/not granted/);
    expect(mocks.a2aGetTask).not.toHaveBeenCalled();
  });

  it("rejects tampered, cross-user, cross-org, cross-app, cross-task, and expired handles fail-closed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    vi.stubEnv("A2A_SECRET", "sealed-handle-secret");
    mocks.getOrgSetting.mockResolvedValue({ mode: "all-apps" });
    mocks.getOrgDomain.mockResolvedValue("builder.io");
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-bound",
      status: { state: "working" },
    });

    const submitted = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        askGrantedDispatchMcpApp("analytics", "Compute revenue.", {
          async: true,
        }),
    );
    const validHandle = submitted.taskHandle ?? "";
    expect(validHandle).toMatch(/^v1\./);
    const tamperedHandle = `${validHandle.slice(0, -1)}${validHandle.endsWith("a") ? "b" : "a"}`;
    const invalidHandlePattern =
      /Invalid or expired ask_app task handle\. To keep polling the same task, call ask_app_status with the app and taskId from the ask_app result and leave out taskHandle\. Do not resubmit ask_app; that can duplicate work\./;

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          orgId: "org-1",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          getGrantedDispatchMcpAppTask("analytics", "task-bound", {
            taskHandle: tamperedHandle,
          }),
      ),
    ).rejects.toThrow(invalidHandlePattern);

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          orgId: "org-1",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          getGrantedDispatchMcpAppTask("analytics", "task-bound", {
            taskHandle: "",
          }),
      ),
    ).rejects.toThrow(invalidHandlePattern);

    await expect(
      runWithRequestContext(
        {
          userEmail: "mallory@example.test",
          orgId: "org-1",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          getGrantedDispatchMcpAppTask("analytics", "task-bound", {
            taskHandle: validHandle,
          }),
      ),
    ).rejects.toThrow(invalidHandlePattern);

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          orgId: "org-2",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          getGrantedDispatchMcpAppTask("analytics", "task-bound", {
            taskHandle: validHandle,
          }),
      ),
    ).rejects.toThrow(invalidHandlePattern);

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          orgId: "org-1",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          getGrantedDispatchMcpAppTask("mail", "task-bound", {
            taskHandle: validHandle,
          }),
      ),
    ).rejects.toThrow(invalidHandlePattern);

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          orgId: "org-1",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          getGrantedDispatchMcpAppTask("analytics", "task-other", {
            taskHandle: validHandle,
          }),
      ),
    ).rejects.toThrow(invalidHandlePattern);

    vi.advanceTimersByTime(60 * 60 * 1000 + 1_000);
    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          orgId: "org-1",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          getGrantedDispatchMcpAppTask("analytics", "task-bound", {
            taskHandle: validHandle,
          }),
      ),
    ).rejects.toThrow(invalidHandlePattern);

    expect(mocks.a2aGetTask).not.toHaveBeenCalled();

    mocks.a2aGetTask.mockResolvedValueOnce({
      id: "task-bound",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "Recovered via legacy poll." }],
        },
      },
    });
    const legacyRecovered = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "http://localhost:8092",
      },
      () => getGrantedDispatchMcpAppTask("analytics", "task-bound"),
    );
    expect(legacyRecovered).toEqual({
      app: "analytics",
      routedVia: "a2a",
      taskId: "task-bound",
      status: "completed",
      response: "Recovered via legacy poll.",
    });
  });

  it("forwards optional taskHandle through the ask_app_status action while preserving legacy callers", async () => {
    vi.stubEnv("A2A_SECRET", "sealed-handle-secret");
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-via-action",
      status: { state: "working" },
    });

    const submitted = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        askGrantedDispatchMcpApp("analytics", "Build summary.", {
          async: true,
        }),
    );

    mocks.discoverAgents.mockReset();
    mocks.discoverAgents.mockResolvedValue([
      { ...analyticsAgent, url: "http://localhost:9999" },
    ]);
    mocks.a2aConstructor.mockClear();
    mocks.a2aGetTask.mockResolvedValueOnce({
      id: "task-via-action",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "Summary done." }],
        },
      },
    });

    const withHandle = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        askAppStatusAction.run({
          app: "analytics",
          taskId: "task-via-action",
          taskHandle: submitted.taskHandle,
        }),
    );
    expect(withHandle).toMatchObject({
      app: "analytics",
      taskId: "task-via-action",
      status: "completed",
      response: "Summary done.",
    });
    expect(mocks.discoverAgents).not.toHaveBeenCalled();
    expect(mocks.a2aConstructor).toHaveBeenCalledWith(
      "http://localhost:8086",
      "signed-token",
      expect.objectContaining({ requestTimeoutMs: 10_000 }),
    );

    mocks.a2aConstructor.mockClear();
    mocks.a2aGetTask.mockResolvedValueOnce({
      id: "task-via-action",
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "Legacy summary done." }],
        },
      },
    });
    const withoutHandle = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        askAppStatusAction.run({
          app: "analytics",
          taskId: "task-via-action",
        }),
    );
    expect(withoutHandle).toMatchObject({
      app: "analytics",
      taskId: "task-via-action",
      status: "completed",
      response: "Legacy summary done.",
    });
    expect(mocks.discoverAgents).toHaveBeenCalledTimes(1);
    expect(mocks.a2aConstructor).toHaveBeenCalledWith(
      "http://localhost:9999",
      "signed-token",
      expect.objectContaining({ requestTimeoutMs: 10_000 }),
    );
  });
});

describe("openGrantedDispatchMcpApp", () => {
  beforeEach(() => {
    vi.stubEnv("A2A_SECRET", "shared-secret");
  });

  it("opens Dispatch extension routes through the Dispatch app id", async () => {
    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        openGrantedDispatchMcpApp({
          app: "dispatch",
          path: "/extensions/ext-1/github-stars-over-time",
          embed: true,
          chrome: "minimal",
        }),
    );

    expect(result).toEqual({
      app: "dispatch",
      path: "/extensions/ext-1/github-stars-over-time",
      url: "http://localhost:8092/extensions/ext-1/github-stars-over-time",
      embed: true,
      chrome: "minimal",
      embedStartUrl:
        "http://localhost:8092/_agent-native/embed/start?ticket=ticket-123",
      embedTargetPath: "/extensions/ext-1/github-stars-over-time",
      embedExpiresAt: 12345,
    });
  });

  it("pre-mints cross-app embed sessions for MCP app hosts", async () => {
    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        openGrantedDispatchMcpApp({
          app: "analytics",
          path: "/dashboards?range=30d",
          embed: true,
          chrome: "minimal",
        }),
    );

    expect(mocks.managerCallTool).toHaveBeenCalledWith(
      "mcp__target__create_embed_session",
      {
        url: "http://localhost:8086/dashboards?range=30d",
        chrome: "minimal",
      },
    );
    expect(result).toEqual({
      app: "analytics",
      path: "/dashboards?range=30d",
      url: "http://localhost:8086/dashboards?range=30d",
      embed: true,
      chrome: "minimal",
      embedStartUrl:
        "http://localhost:8086/_agent-native/embed/start?ticket=remote",
    });
  });

  it("hands off first-party opens within one second and shares the pending mint with the pane", async () => {
    vi.useFakeTimers();
    const asOwner = <T>(run: () => Promise<T>) =>
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          identityAuthenticatedAtMs: 1,
          requestOrigin: "http://localhost:8092",
        },
        run,
      );
    const startUrl =
      "http://localhost:8086/_agent-native/embed/start?ticket=prefetch-fixture";
    mocks.managerCallTool.mockImplementationOnce(
      (_tool: string, { url }: { url: string }) =>
        new Promise((resolve) => {
          const { pathname, search } = new URL(url);
          setTimeout(
            () =>
              resolve({
                structuredContent: { startUrl, targetPath: pathname + search },
              }),
            12_000,
          );
        }),
    );

    const input = {
      app: "analytics",
      path: "/dashboards",
      chrome: "minimal",
    } as const;
    let handoff:
      | Awaited<ReturnType<typeof openGrantedDispatchMcpApp>>
      | undefined;
    const opening = asOwner(() =>
      openGrantedDispatchMcpApp(
        { ...input, embed: true },
        { prefetchEmbed: true },
      ),
    ).then((result) => {
      handoff = result;
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(handoff).toEqual({
      ...input,
      embed: true,
      url: "http://localhost:8086/dashboards",
    });
    await opening;
    expect(mocks.managerCallTool).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_500);
    const pane = asOwner(() =>
      createGrantedDispatchMcpEmbedSession(input, { bindBrowserTab: true }),
    );
    await vi.advanceTimersByTimeAsync(500);
    const { childBrowserTabId, targetPath } = await pane;
    const launchUrl = new URL(mocks.managerCallTool.mock.calls[0][1].url);
    expect(childBrowserTabId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(launchUrl.searchParams.get("agentNativeTab")).toBe(
      childBrowserTabId,
    );
    expect(targetPath).toBe("/dashboards");
    expect(mocks.managerCallTool).toHaveBeenCalledTimes(1);

    await expect(
      asOwner(() =>
        createGrantedDispatchMcpEmbedSession(input, { bindBrowserTab: true }),
      ),
    ).resolves.toMatchObject({
      startUrl: expect.not.stringContaining("prefetch-fixture"),
    });
    expect(mocks.managerCallTool).toHaveBeenCalledTimes(2);
  });

  it("cancels a stalled prefetch claimed by the pane and runs its fallback mint", async () => {
    vi.useFakeTimers();
    const asOwner = <T>(run: () => Promise<T>) =>
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
          identityAuthenticatedAtMs: 1,
        },
        run,
      );
    const input = {
      app: "analytics",
      path: "/dashboards",
      chrome: "minimal",
    } as const;
    mocks.managerCallTool.mockImplementationOnce(() => new Promise(() => {}));

    await asOwner(() =>
      openGrantedDispatchMcpApp(input, { prefetchEmbed: true }),
    );
    await vi.advanceTimersByTimeAsync(0);
    const pane = asOwner(() =>
      createGrantedDispatchMcpEmbedSession(input, { bindBrowserTab: true }),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pane).resolves.toMatchObject({ app: "analytics" });
    expect(mocks.managerStop).toHaveBeenCalled();
    expect(mocks.managerCallTool).toHaveBeenCalledTimes(2);
  });

  it("checks the current grant and keeps prefetched tickets within the initiating workspace", async () => {
    vi.useFakeTimers();
    const asOwner = <T>(orgId: string, run: () => Promise<T>) =>
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          identityAuthenticatedAtMs: 1,
          orgId,
          requestOrigin: "http://localhost:8092",
        },
        run,
      );
    const startUrl =
      "http://localhost:8086/_agent-native/embed/start?ticket=workspace-fixture";
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: { startUrl },
    });
    const input = {
      app: "analytics",
      path: "/dashboards",
      chrome: "minimal",
    } as const;
    await asOwner("prefetch-workspace", () =>
      openGrantedDispatchMcpApp(input, { prefetchEmbed: true }),
    );
    await vi.advanceTimersByTimeAsync(0);

    await expect(
      asOwner("another-workspace", () =>
        createGrantedDispatchMcpEmbedSession(input, { bindBrowserTab: true }),
      ),
    ).resolves.toMatchObject({
      startUrl: expect.not.stringContaining("workspace-fixture"),
    });

    mocks.getOrgSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: ["dispatch"],
    });
    await expect(
      asOwner("prefetch-workspace", () =>
        createGrantedDispatchMcpEmbedSession(input, { bindBrowserTab: true }),
      ),
    ).rejects.toThrow(/not granted/);
    expect(mocks.managerCallTool).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15_000);
  });

  it("reads the target embed start URL from Core MCP response metadata", async () => {
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        targetPath: "/dashboards?range=30d",
        expiresAt: 12345,
      },
      _meta: {
        "agent-native/embedStart": {
          startUrl:
            "http://localhost:8086/_agent-native/embed/start?ticket=remote",
        },
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        openGrantedDispatchMcpApp({
          app: "analytics",
          path: "/dashboards?range=30d",
          embed: true,
          chrome: "minimal",
        }),
    );

    expect(result).toMatchObject({
      app: "analytics",
      embedStartUrl:
        "http://localhost:8086/_agent-native/embed/start?ticket=remote",
      embedTargetPath: "/dashboards?range=30d",
      embedExpiresAt: 12345,
    });
  });

  it("answers with the link and stops the target when it is slow to mint a session", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      let rejectCall: (error: Error) => void = () => {};
      mocks.managerCallTool.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectCall = reject;
          }),
      );
      // Stopping the client fails its pending call, as the SDK transport does.
      mocks.managerStop.mockImplementation(async () =>
        rejectCall(new Error("Connection closed")),
      );
      const pending = runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          openGrantedDispatchMcpApp({
            app: "analytics",
            path: "/dashboards",
            embed: true,
          }),
      );
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await pending;
      expect(result).toMatchObject({
        app: "analytics",
        url: "http://localhost:8086/dashboards",
      });
      expect(result).not.toHaveProperty("embedStartUrl");
      await vi.advanceTimersByTimeAsync(60_000);
      // The abandoned request was stopped, not retried in the background.
      expect(mocks.managerCallTool).toHaveBeenCalledTimes(1);
      expect(mocks.managerStop).toHaveBeenCalled();
    } finally {
      mocks.managerStop.mockReset();
      mocks.managerStop.mockResolvedValue(undefined);
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("reads the target embed start URL when Core returns JSON text", async () => {
    mocks.managerCallTool.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            targetPath: "/dashboards?range=30d",
            expiresAt: 12345,
          }),
        },
      ],
      _meta: {
        "agent-native/embedStart": {
          startUrl:
            "http://localhost:8086/_agent-native/embed/start?ticket=remote",
        },
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        openGrantedDispatchMcpApp({
          app: "analytics",
          path: "/dashboards?range=30d",
          embed: true,
          chrome: "minimal",
        }),
    );

    expect(result).toMatchObject({
      app: "analytics",
      embedStartUrl:
        "http://localhost:8086/_agent-native/embed/start?ticket=remote",
      embedTargetPath: "/dashboards?range=30d",
      embedExpiresAt: 12345,
    });
  });

  it.each([408, 429, 502, 503, 504])(
    "retries transient typed HTTP %i target MCP failures with HTML bodies",
    async (status) => {
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
      mocks.managerCallTool
        .mockRejectedValueOnce(
          Object.assign(
            new Error(
              'MCP server "target" is not connected: That URL returned a web page instead of an MCP response. Check that you pasted the Streamable HTTP endpoint, often ending in /mcp.',
            ),
            { code: status },
          ),
        )
        .mockResolvedValueOnce({
          structuredContent: {
            startUrl:
              "http://localhost:8086/_agent-native/embed/start?ticket=remote",
          },
        });

      const result = await runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          openGrantedDispatchMcpApp({
            app: "analytics",
            path: "/dashboards",
            embed: true,
          }),
      );

      expect(mocks.managerConstructor).toHaveBeenCalledTimes(2);
      expect(mocks.managerStart).toHaveBeenCalledTimes(2);
      expect(mocks.managerStop).toHaveBeenCalledTimes(2);
      expect(mocks.managerCallTool).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({
        app: "analytics",
        embedStartUrl:
          "http://localhost:8086/_agent-native/embed/start?ticket=remote",
      });
      randomSpy.mockRestore();
    },
  );

  it("does not retry an HTML 404 whose body mentions a gateway status", async () => {
    mocks.managerCallTool.mockRejectedValueOnce(
      Object.assign(
        new Error(
          'MCP server "target" is not connected: That URL returned a web page instead of an MCP response. Cloudflare HTTP 502 is unrelated.',
        ),
        { code: 404 },
      ),
    );

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/dashboards",
          }),
      ),
    ).rejects.toThrow(/Cloudflare HTTP 502 is unrelated/);
    expect(mocks.managerCallTool).toHaveBeenCalledTimes(1);
  });

  it("does not retry a typed permanent 4xx MCP error", async () => {
    mocks.managerCallTool.mockRejectedValueOnce(
      Object.assign(
        new Error(
          "Streamable HTTP error: Error POSTing to endpoint: <!doctype html><html>422</html>",
        ),
        { code: 422 },
      ),
    );

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/dashboards",
          }),
      ),
    ).rejects.toThrow(/Streamable HTTP error/);
    expect(mocks.managerCallTool).toHaveBeenCalledTimes(1);
  });

  it("sends no delegated credential to a plain-HTTP target off this machine", async () => {
    mocks.discoverAgents.mockResolvedValue([
      { ...analyticsAgent, url: "http://analytics.example.test" },
    ]);
    mocks.managerCallTool.mockClear();

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/dashboards",
          }),
      ),
    ).rejects.toThrow(/HTTPS target endpoint/);
    expect(mocks.managerCallTool).not.toHaveBeenCalled();
  });

  it("returns the normal open URL when embed preminting fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.managerCallTool.mockRejectedValueOnce(
      new Error("Target app did not return an embed session."),
    );

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        openGrantedDispatchMcpApp({
          app: "analytics",
          path: "/dashboards",
          embed: true,
          chrome: "minimal",
        }),
    );

    expect(result).toEqual({
      app: "analytics",
      path: "/dashboards",
      url: "http://localhost:8086/dashboards",
      embed: true,
      chrome: "minimal",
      embedUnavailable: "Target app did not return an embed session.",
    });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("pre-mints no session for a target whose endpoint is plain HTTP off this machine", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.discoverAgents.mockResolvedValue([
      { ...analyticsAgent, url: "http://analytics.example.test" },
    ]);
    mocks.managerCallTool.mockClear();

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        openGrantedDispatchMcpApp({
          app: "analytics",
          path: "/dashboards",
          embed: true,
        }),
    );

    expect(mocks.managerCallTool).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("embedStartUrl");
    expect(result).toMatchObject({
      embedUnavailable: expect.stringContaining("HTTPS target endpoint"),
    });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("answers with the link when the target is slow to mint a session", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      let rejectCall: (error: Error) => void = () => {};
      mocks.managerCallTool.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectCall = reject;
          }),
      );
      // Stopping the client fails its pending call, as the SDK transport does.
      mocks.managerStop.mockImplementation(async () =>
        rejectCall(new Error("Connection closed")),
      );
      const pending = runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          openGrantedDispatchMcpApp({
            app: "analytics",
            path: "/dashboards",
            embed: true,
          }),
      );
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(pending).resolves.toMatchObject({
        url: "http://localhost:8086/dashboards",
        embedUnavailable: expect.stringContaining("within 15s"),
      });
      await vi.advanceTimersByTimeAsync(60_000);
      // The abandoned request was stopped, not retried in the background.
      expect(mocks.managerCallTool).toHaveBeenCalledTimes(1);
      expect(mocks.managerStop).toHaveBeenCalled();
    } finally {
      mocks.managerStop.mockReset();
      mocks.managerStop.mockResolvedValue(undefined);
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("rejects Dispatch-owned extension routes on sibling apps", async () => {
    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          openGrantedDispatchMcpApp({
            app: "analytics",
            path: "/extensions/ext-1/github-stars-over-time",
          }),
      ),
    ).rejects.toThrow(/belongs to Dispatch/);
  });

  it("rejects traversal that normalizes into Dispatch-owned routes on sibling apps", async () => {
    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          openGrantedDispatchMcpApp({
            app: "analytics",
            path: "/../dispatch/extensions/ext-1",
          }),
      ),
    ).rejects.toThrow(/safe app-relative route/);
  });
});

describe("createGrantedDispatchMcpEmbedSession", () => {
  beforeEach(() => {
    vi.stubEnv("A2A_SECRET", "shared-secret");
  });

  it("mints Dispatch self embeds locally instead of recursively calling Dispatch MCP", async () => {
    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "dispatch",
          path: "/extensions/ext-1/github-stars-over-time",
          chrome: "minimal",
        }),
    );

    expect(mocks.createEmbedSessionTicket).toHaveBeenCalledWith({
      ownerEmail: "owner@example.test",
      orgId: undefined,
      targetPath: "/extensions/ext-1/github-stars-over-time",
      scope: "minimal",
    });
    expect(mocks.managerConstructor).not.toHaveBeenCalled();
    expect(result).toEqual({
      app: "dispatch",
      startUrl:
        "http://localhost:8092/_agent-native/embed/start?ticket=ticket-123",
      targetPath: "/extensions/ext-1/github-stars-over-time",
      expiresAt: 12345,
    });
  });

  it("pins Dispatch self embeds to configured hosts instead of request context", async () => {
    vi.stubEnv("WORKSPACE_GATEWAY_URL", "");
    vi.stubEnv("APP_URL", "https://dispatch.agent-native.test");
    vi.stubEnv("APP_BASE_PATH", "");
    vi.stubEnv("VITE_APP_BASE_PATH", "");

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://attacker.example",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "dispatch",
          path: "/extensions/ext-1/github-stars-over-time",
          chrome: "minimal",
        }),
    );

    expect(result.startUrl).toBe(
      "https://dispatch.agent-native.test/_agent-native/embed/start?ticket=ticket-123",
    );
  });

  it("logs an invalid production origin while accepting a trusted runtime origin", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("APP_URL", "not-a-url");
    vi.stubEnv("WORKSPACE_GATEWAY_URL", "https://runtime.example/dispatch");
    vi.stubEnv("APP_BASE_PATH", "");

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://runtime.example",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "dispatch",
          path: "/extensions/ext-1/github-stars-over-time",
          chrome: "minimal",
        }),
    );

    expect(result.startUrl).toBe(
      "https://runtime.example/_agent-native/embed/start?ticket=ticket-123",
    );
    expect(warn).toHaveBeenCalledWith(
      "[dispatch] invalid configured request origin",
      { source: "production" },
    );
  });

  it("keeps workspace sign-in behind the rollout flag", async () => {
    mocks.isFeatureFlagEnabled.mockResolvedValue(false);

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createWorkspaceSsoEmbedSession({
            app: "analytics",
            path: "/overview",
          }),
      ),
    ).rejects.toThrow(/not enabled/);
    expect(mocks.managerConstructor).not.toHaveBeenCalled();
  });

  it("allows Desktop workspace sign-in when Dispatch pane SSO is off", async () => {
    mocks.isFeatureFlagEnabled.mockImplementation(
      async (flag) => flag.key === "desktop.workspace-sso",
    );

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createWorkspaceSsoEmbedSession({
            app: "analytics",
            path: "/overview",
          }),
      ),
    ).resolves.toMatchObject({ app: "analytics" });

    expect(
      mocks.isFeatureFlagEnabled.mock.calls.map(([flag]) => flag.key),
    ).toEqual(["dispatch.workspace-sso", "desktop.workspace-sso"]);
    expect(mocks.managerConstructor).toHaveBeenCalled();
  });

  it("allows an exact canonical app without requiring an MCP app grant", async () => {
    mocks.getUserSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: [],
    });
    mocks.discoverAgents.mockResolvedValue([
      {
        ...analyticsAgent,
        url: "https://analytics.agent-native.com",
      },
    ]);
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl:
          "https://analytics.agent-native.com/_agent-native/embed/start?ticket=remote",
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://dispatch.agent-native.com",
      },
      () =>
        createWorkspaceSsoEmbedSession({
          app: "analytics",
          path: "/overview",
          chrome: "minimal",
        }),
    );

    expect(result).toMatchObject({
      app: "analytics",
      startUrl:
        "https://analytics.agent-native.com/_agent-native/embed/start?ticket=remote",
    });
    expect(mocks.managerConstructor).toHaveBeenCalled();
  });

  it("keeps canonical workspace SSO apps eligible on the beta lane", async () => {
    mocks.getUserSetting.mockResolvedValue({
      mode: "selected-apps",
      selectedAppIds: [],
    });
    mocks.discoverAgents.mockResolvedValue([
      {
        ...analyticsAgent,
        url: "https://analytics.agent-native.com",
      },
    ]);
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl:
          "https://beta.analytics.agent-native.com/_agent-native/embed/start?ticket=remote",
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://beta.dispatch.agent-native.com",
      },
      () =>
        createWorkspaceSsoEmbedSession({
          app: "analytics",
          path: "/overview",
        }),
    );

    expect(result).toMatchObject({
      app: "analytics",
      startUrl:
        "https://beta.analytics.agent-native.com/_agent-native/embed/start?ticket=remote",
    });
    expect(mocks.managerConstructor).toHaveBeenCalled();
  });

  it.each(["workspace-sso", "dispatch-grant"] as const)(
    "uses a mounted app's MCP endpoint for %s embeds when Dispatch shares its host",
    async (route) => {
      vi.stubEnv("A2A_SECRET", "test-a2a-secret");
      vi.stubEnv(
        "WORKSPACE_GATEWAY_URL",
        "https://beta.agent-workspace.builder.io",
      );
      vi.stubEnv("APP_BASE_PATH", "/dispatch");
      vi.stubEnv("VITE_APP_BASE_PATH", "");
      vi.stubEnv(
        "IDENTITY_SSO_APP_REGISTRY_JSON",
        JSON.stringify([
          {
            appId: "customer-ticket-triage",
            clientId: "workspace-client",
            origin: "https://beta.agent-workspace.builder.io",
            callbackPath: "/_agent-native/identity/callback",
            capabilities: ["identity-sso"],
          },
        ]),
      );
      const workspaceApp = {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        path: "/customer-ticket-triage",
        url: "https://beta.agent-workspace.builder.io/customer-ticket-triage",
        isDispatch: false,
      };
      mocks.listWorkspaceApps.mockResolvedValue([workspaceApp]);
      mocks.discoverAgents.mockResolvedValue([
        {
          id: workspaceApp.id,
          name: workspaceApp.name,
          description: workspaceApp.description,
          url: workspaceApp.url,
          color: "#14B8A6",
        },
      ]);
      mocks.getUserSetting.mockResolvedValue({ mode: "all-apps" });
      mocks.managerCallTool.mockImplementation(async (_tool, args) =>
        args.runtime
          ? {
              structuredContent: {
                runtime: "workspace-app-chat",
                token: "private-chat-credential",
                targetPath: "/",
                expiresAt: Date.now() + 900000,
              },
            }
          : {
              structuredContent: {
                startUrl:
                  "https://beta.agent-workspace.builder.io/customer-ticket-triage/_agent-native/embed/start?ticket=remote",
              },
            },
      );

      const result = await runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "https://beta.agent-workspace.builder.io",
        },
        () => {
          const input = {
            app: workspaceApp.id,
            path: "/",
            chrome: "minimal" as const,
          };
          return route === "workspace-sso"
            ? createWorkspaceSsoEmbedSession(input)
            : createGrantedDispatchMcpEmbedSession(input);
        },
      );

      expect(mocks.managerConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          servers: {
            target: expect.objectContaining({
              url: "https://beta.agent-workspace.builder.io/customer-ticket-triage/mcp",
              headers: {
                Authorization: "Bearer signed-token",
                "x-agent-native-mcp-inline-apps": "1",
              },
            }),
          },
        }),
      );
      expect(mocks.signA2AToken).toHaveBeenCalledWith(
        "owner@example.test",
        undefined,
        undefined,
        expect.objectContaining({
          audience:
            "https://beta.agent-workspace.builder.io/customer-ticket-triage/mcp",
          preferGlobalSecret: true,
        }),
      );
      expect(mocks.managerCallTool).toHaveBeenCalledWith(
        "mcp__target__create_embed_session",
        {
          url: "https://beta.agent-workspace.builder.io/customer-ticket-triage/",
          chrome: "minimal",
        },
      );
      expect(result.startUrl).toBe(
        "https://beta.agent-workspace.builder.io/customer-ticket-triage/_agent-native/embed/start?ticket=remote",
      );

      const chatSession = await runWithRequestContext(
        {
          userEmail: "owner@example.test",
          identityAuthenticatedAtMs: Date.now() - 1000,
          requestOrigin: "https://beta.agent-workspace.builder.io",
        },
        () =>
          route === "workspace-sso"
            ? createWorkspaceSsoEmbedSessionForWorkspaceAppChat(workspaceApp.id)
            : createGrantedDispatchMcpEmbedSessionForWorkspaceAppChat(
                workspaceApp.id,
              ),
      );
      expect(chatSession.appBaseUrl).toBe(
        "https://beta.agent-workspace.builder.io/customer-ticket-triage",
      );
    },
  );

  it("keeps mounted document and explicit chat grants separate when the registry URL is a Dispatch page", async () => {
    vi.stubEnv("A2A_SECRET", "test-a2a-secret");
    vi.stubEnv(
      "WORKSPACE_GATEWAY_URL",
      "https://beta.agent-workspace.builder.io/dispatch",
    );
    vi.stubEnv("APP_BASE_PATH", "");
    vi.stubEnv("VITE_APP_BASE_PATH", "");
    vi.stubEnv(
      "IDENTITY_SSO_APP_REGISTRY_JSON",
      JSON.stringify([
        {
          appId: "customer-ticket-triage",
          clientId: "workspace-client",
          origin: "https://beta.agent-workspace.builder.io",
          callbackPath: "/_agent-native/identity/callback",
          capabilities: ["identity-sso"],
        },
      ]),
    );
    mocks.discoverAgents.mockResolvedValue([]);
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        path: "/customer-ticket-triage",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
        isDispatch: false,
      },
    ]);
    mocks.managerCallTool.mockImplementation(async (_tool, args) => {
      if (args.runtime) {
        return {
          structuredContent: {
            runtime: "workspace-app-chat",
            token: "private-chat-credential",
            targetPath: "/",
            expiresAt: Date.now() + 900000,
          },
        };
      }
      return {
        structuredContent: {
          startUrl:
            "https://beta.agent-workspace.builder.io/dispatch/_agent-native/embed/start?ticket=remote",
        },
      };
    });

    // Independent auth review: retain the document assertion, then pin the
    // separate chat caller's explicit purpose. Public inputs cannot escalate it.
    await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://beta.dispatch.agent-native.com",
      },
      () =>
        createWorkspaceSsoEmbedSession({
          app: "customer-ticket-triage",
          path: "/",
          chrome: "minimal",
          runtime: "workspace-app-chat",
        } as any),
    );
    expect(mocks.managerCallTool).toHaveBeenCalledWith(
      "mcp__target__create_embed_session",
      {
        url: "https://beta.agent-workspace.builder.io/customer-ticket-triage/",
        chrome: "minimal",
      },
    );

    expect(mocks.managerConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        servers: {
          target: expect.objectContaining({
            url: "https://beta.agent-workspace.builder.io/dispatch/mcp",
          }),
        },
      }),
    );
    expect(mocks.signA2AToken).toHaveBeenCalledWith(
      "owner@example.test",
      undefined,
      undefined,
      expect.objectContaining({
        audience: "https://beta.agent-workspace.builder.io/dispatch/mcp",
        preferGlobalSecret: true,
      }),
    );
    mocks.managerConstructor.mockClear();
    mocks.signA2AToken.mockClear();

    const session = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        identityAuthenticatedAtMs: Date.now() - 1000,
        requestOrigin: "https://beta.dispatch.agent-native.com",
      },
      () =>
        createWorkspaceSsoEmbedSessionForWorkspaceAppChat(
          "customer-ticket-triage",
        ),
    );

    expect(mocks.managerConstructor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        servers: {
          target: expect.objectContaining({
            url: "https://beta.agent-workspace.builder.io/customer-ticket-triage/mcp",
          }),
        },
      }),
    );
    expect(mocks.signA2AToken).toHaveBeenCalledWith(
      "owner@example.test",
      undefined,
      undefined,
      expect.objectContaining({
        audience:
          "https://beta.agent-workspace.builder.io/customer-ticket-triage/mcp",
        preferGlobalSecret: true,
      }),
    );

    expect(mocks.managerCallTool).toHaveBeenLastCalledWith(
      "mcp__target__create_embed_session",
      {
        url: "https://beta.agent-workspace.builder.io/customer-ticket-triage/",
        chrome: "minimal",
        runtime: "workspace-app-chat",
      },
    );
    expect(mocks.signA2AToken).toHaveBeenLastCalledWith(
      "owner@example.test",
      undefined,
      undefined,
      expect.objectContaining({
        extraClaims: expect.objectContaining({
          org_id: null,
          agent_native_workspace_app_chat: true,
          agent_native_chat_grant_issued_at_ms: expect.any(Number),
        }),
      }),
    );
    expect(session).toEqual({
      token: "private-chat-credential",
      targetPath: "/",
      expiresAt: expect.any(Number),
      appBaseUrl:
        "https://beta.agent-workspace.builder.io/customer-ticket-triage",
    });
  });

  it("skips a malformed mounted app while resolving a valid embedded chat sibling", async () => {
    vi.stubEnv("A2A_SECRET", "test-a2a-secret");
    vi.stubEnv(
      "WORKSPACE_GATEWAY_URL",
      "https://beta.agent-workspace.builder.io/dispatch",
    );
    vi.stubEnv("APP_BASE_PATH", "");
    vi.stubEnv("VITE_APP_BASE_PATH", "");
    vi.stubEnv(
      "IDENTITY_SSO_APP_REGISTRY_JSON",
      JSON.stringify([
        {
          appId: "customer-ticket-triage",
          clientId: "workspace-client",
          origin: "https://beta.agent-workspace.builder.io",
          callbackPath: "/_agent-native/identity/callback",
          capabilities: ["identity-sso"],
        },
      ]),
    );
    const mountedApps = [
      {
        id: "malformed-app",
        name: "Malformed app",
        description: "Invalid mounted path",
        path: "//invalid",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/malformed-app",
        isDispatch: false,
      },
      {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        path: "/customer-ticket-triage",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
        isDispatch: false,
      },
    ];
    mocks.listWorkspaceApps.mockResolvedValue(mountedApps);
    mocks.discoverAgents.mockResolvedValue(
      mountedApps.map((app) => ({
        id: app.id,
        name: app.name,
        description: app.description,
        url: app.url,
        color: "#14B8A6",
      })),
    );
    mocks.managerCallTool.mockImplementation(async (_tool, args) =>
      args.runtime
        ? {
            structuredContent: {
              runtime: "workspace-app-chat",
              token: "private-chat-credential",
              targetPath: "/",
              expiresAt: Date.now() + 900000,
            },
          }
        : {
            structuredContent: {
              startUrl:
                "https://beta.agent-workspace.builder.io/dispatch/_agent-native/embed/start?ticket=remote",
            },
          },
    );

    const apps = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://beta.dispatch.agent-native.com",
      },
      () => listGrantedDispatchMcpApps(),
    );

    expect(
      apps.find((app) => app.id === "malformed-app")?.homeUrl,
    ).toBeUndefined();
    expect(
      apps.find((app) => app.id === "customer-ticket-triage")?.homeUrl,
    ).toBe("https://beta.agent-workspace.builder.io/customer-ticket-triage");

    const session = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        identityAuthenticatedAtMs: Date.now() - 1000,
        requestOrigin: "https://beta.dispatch.agent-native.com",
      },
      () =>
        createWorkspaceSsoEmbedSessionForWorkspaceAppChat(
          "customer-ticket-triage",
        ),
    );

    expect(session.appBaseUrl).toBe(
      "https://beta.agent-workspace.builder.io/customer-ticket-triage",
    );
  });

  it.each([
    [
      "workspace-sso",
      "gateway mount path",
      "https://beta.agent-workspace.builder.io/dispatch",
      "",
    ],
    [
      "dispatch-grant",
      "gateway mount path",
      "https://beta.agent-workspace.builder.io/dispatch",
      "",
    ],
    [
      "workspace-sso",
      "APP_BASE_PATH",
      "https://beta.agent-workspace.builder.io",
      "/dispatch",
    ],
    [
      "dispatch-grant",
      "APP_BASE_PATH",
      "https://beta.agent-workspace.builder.io",
      "/dispatch",
    ],
  ] as const)(
    "uses the mounted Workspace MCP endpoint and audience for %s embeds with %s",
    async (route, _mountConfig, gatewayUrl, appBasePath) => {
      vi.stubEnv("A2A_SECRET", "test-a2a-secret");
      vi.stubEnv("WORKSPACE_GATEWAY_URL", gatewayUrl);
      vi.stubEnv("APP_BASE_PATH", appBasePath);
      vi.stubEnv("VITE_APP_BASE_PATH", "");
      vi.stubEnv(
        "IDENTITY_SSO_APP_REGISTRY_JSON",
        JSON.stringify([
          {
            appId: "customer-ticket-triage",
            clientId: "workspace-client",
            origin: "https://beta.agent-workspace.builder.io",
            callbackPath: "/_agent-native/identity/callback",
            capabilities: ["identity-sso"],
          },
        ]),
      );
      const workspaceApp = {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        path: "/customer-ticket-triage",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
        isDispatch: false,
      };
      mocks.listWorkspaceApps.mockResolvedValue([workspaceApp]);
      mocks.discoverAgents.mockResolvedValue([
        {
          id: workspaceApp.id,
          name: workspaceApp.name,
          description: workspaceApp.description,
          url: workspaceApp.url,
          color: "#14B8A6",
        },
      ]);
      mocks.managerCallTool.mockResolvedValueOnce({
        structuredContent: {
          startUrl:
            "https://beta.agent-workspace.builder.io/dispatch/_agent-native/embed/start?ticket=remote",
        },
      });

      const result = await runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "https://beta.dispatch.agent-native.com",
        },
        () =>
          route === "workspace-sso"
            ? createWorkspaceSsoEmbedSession({
                app: workspaceApp.id,
                path: "/triage",
                chrome: "minimal",
              })
            : createGrantedDispatchMcpEmbedSession({
                app: workspaceApp.id,
                path: "/triage",
                chrome: "minimal",
              }),
      );

      expect(mocks.managerConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          servers: {
            target: expect.objectContaining({
              url: "https://beta.agent-workspace.builder.io/dispatch/mcp",
              headers: {
                Authorization: "Bearer signed-token",
                "x-agent-native-mcp-inline-apps": "1",
              },
            }),
          },
        }),
      );
      expect(mocks.signA2AToken).toHaveBeenCalledWith(
        "owner@example.test",
        undefined,
        undefined,
        expect.objectContaining({
          audience: "https://beta.agent-workspace.builder.io/dispatch/mcp",
          preferGlobalSecret: true,
        }),
      );
      expect(mocks.managerCallTool).toHaveBeenCalledWith(
        "mcp__target__create_embed_session",
        {
          url: "https://beta.agent-workspace.builder.io/customer-ticket-triage/triage",
          chrome: "minimal",
        },
      );
      expect(result.startUrl).toBe(
        "https://beta.agent-workspace.builder.io/dispatch/_agent-native/embed/start?ticket=remote",
      );

      mocks.managerCallTool.mockResolvedValueOnce({
        structuredContent: {
          startUrl:
            "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage/_agent-native/embed/start?ticket=sibling",
        },
      });
      await expect(
        runWithRequestContext(
          {
            userEmail: "owner@example.test",
            requestOrigin: "https://beta.dispatch.agent-native.com",
          },
          () =>
            route === "workspace-sso"
              ? createWorkspaceSsoEmbedSession({
                  app: workspaceApp.id,
                  path: "/",
                  chrome: "minimal",
                })
              : createGrantedDispatchMcpEmbedSession({
                  app: workspaceApp.id,
                  path: "/",
                  chrome: "minimal",
                }),
        ),
      ).rejects.toThrow(/invalid embed start URL/);
    },
  );

  it.each(["workspace-sso", "dispatch-grant"] as const)(
    "routes root-mounted Workspace app chat directly through %s without changing document embeds",
    async (route) => {
      vi.stubEnv("A2A_SECRET", "test-a2a-secret");
      vi.stubEnv("APP_URL", "https://beta.agent-workspace.builder.io");
      vi.stubEnv(
        "WORKSPACE_GATEWAY_URL",
        "https://beta.agent-workspace.builder.io/dispatch",
      );
      vi.stubEnv("APP_BASE_PATH", "");
      vi.stubEnv("VITE_APP_BASE_PATH", "");
      vi.stubEnv(
        "IDENTITY_SSO_APP_REGISTRY_JSON",
        JSON.stringify([
          {
            appId: "customer-ticket-triage",
            clientId: "workspace-client",
            origin: "https://beta.agent-workspace.builder.io",
            callbackPath: "/_agent-native/identity/callback",
            capabilities: ["identity-sso"],
          },
        ]),
      );
      const workspaceApp = {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        path: "/",
        url: "https://beta.agent-workspace.builder.io",
        isDispatch: false,
      };
      mocks.listWorkspaceApps.mockResolvedValue([workspaceApp]);
      mocks.discoverAgents.mockResolvedValue([
        { ...workspaceApp, color: "#14B8A6" },
      ]);
      mocks.managerCallTool.mockImplementation(async (_tool, args) =>
        args.runtime
          ? {
              structuredContent: {
                runtime: "workspace-app-chat",
                token: "private-chat-credential",
                targetPath: "/",
                expiresAt: Date.now() + 900000,
              },
            }
          : {
              structuredContent: {
                startUrl:
                  "https://beta.agent-workspace.builder.io/dispatch/_agent-native/embed/start?ticket=remote",
              },
            },
      );
      const context = {
        userEmail: "owner@example.test",
        identityAuthenticatedAtMs: Date.now() - 1000,
        requestOrigin: "https://beta.dispatch.agent-native.com",
      };

      const document = await runWithRequestContext(context, () => {
        const input = {
          app: workspaceApp.id,
          path: "/",
          chrome: "minimal" as const,
        };
        return route === "workspace-sso"
          ? createWorkspaceSsoEmbedSession(input)
          : createGrantedDispatchMcpEmbedSession(input);
      });
      expect(mocks.managerConstructor).toHaveBeenLastCalledWith(
        expect.objectContaining({
          servers: {
            target: expect.objectContaining({
              url: "https://beta.agent-workspace.builder.io/dispatch/mcp",
            }),
          },
        }),
      );
      expect(mocks.managerCallTool).toHaveBeenLastCalledWith(
        "mcp__target__create_embed_session",
        { url: "https://beta.agent-workspace.builder.io/", chrome: "minimal" },
      );
      expect(document.startUrl).toBe(
        "https://beta.agent-workspace.builder.io/dispatch/_agent-native/embed/start?ticket=remote",
      );

      const chat = await runWithRequestContext(context, () =>
        route === "workspace-sso"
          ? createWorkspaceSsoEmbedSessionForWorkspaceAppChat(workspaceApp.id)
          : createGrantedDispatchMcpEmbedSessionForWorkspaceAppChat(
              workspaceApp.id,
            ),
      );
      expect.soft(mocks.managerConstructor).toHaveBeenLastCalledWith(
        expect.objectContaining({
          servers: {
            target: expect.objectContaining({
              url: "https://beta.agent-workspace.builder.io/mcp",
            }),
          },
        }),
      );
      expect(mocks.managerCallTool).toHaveBeenLastCalledWith(
        "mcp__target__create_embed_session",
        {
          url: "https://beta.agent-workspace.builder.io/",
          chrome: "minimal",
          runtime: "workspace-app-chat",
        },
      );
      expect.soft(chat).toEqual({
        token: "private-chat-credential",
        targetPath: "/",
        expiresAt: expect.any(Number),
        appBaseUrl: "https://beta.agent-workspace.builder.io",
      });
    },
  );

  it.each(["workspace-sso", "dispatch-grant"] as const)(
    "retains the Workspace gateway path for discovered-only app chats through %s",
    async (route) => {
      vi.stubEnv("A2A_SECRET", "test-a2a-secret");
      vi.stubEnv("APP_URL", "https://beta.agent-workspace.builder.io");
      vi.stubEnv(
        "WORKSPACE_GATEWAY_URL",
        "https://beta.agent-workspace.builder.io/dispatch",
      );
      vi.stubEnv("APP_BASE_PATH", "");
      vi.stubEnv("VITE_APP_BASE_PATH", "");
      vi.stubEnv(
        "IDENTITY_SSO_APP_REGISTRY_JSON",
        JSON.stringify([
          {
            appId: "customer-ticket-triage",
            clientId: "workspace-client",
            origin: "https://beta.agent-workspace.builder.io",
            callbackPath: "/_agent-native/identity/callback",
            capabilities: ["identity-sso"],
          },
        ]),
      );
      mocks.listWorkspaceApps.mockResolvedValue([]);
      mocks.discoverAgents.mockResolvedValue([
        {
          id: "customer-ticket-triage",
          name: "Customer Ticket Triage",
          description: "Triage customer tickets",
          url: "https://beta.agent-workspace.builder.io",
          color: "#14B8A6",
        },
      ]);
      mocks.managerCallTool.mockImplementation(async (_tool, args) =>
        args.runtime
          ? {
              structuredContent: {
                runtime: "workspace-app-chat",
                token: "private-chat-credential",
                targetPath: "/",
                expiresAt: Date.now() + 900000,
              },
            }
          : {
              structuredContent: {
                startUrl:
                  "https://beta.agent-workspace.builder.io/dispatch/_agent-native/embed/start?ticket=remote",
              },
            },
      );

      const result = await runWithRequestContext(
        {
          userEmail: "owner@example.test",
          identityAuthenticatedAtMs: Date.now() - 1000,
          requestOrigin: "https://beta.dispatch.agent-native.com",
        },
        () =>
          route === "workspace-sso"
            ? createWorkspaceSsoEmbedSessionForWorkspaceAppChat(
                "customer-ticket-triage",
              )
            : createGrantedDispatchMcpEmbedSessionForWorkspaceAppChat(
                "customer-ticket-triage",
              ),
      );

      expect(result).toEqual({
        token: "private-chat-credential",
        targetPath: "/",
        expiresAt: expect.any(Number),
        appBaseUrl: "https://beta.agent-workspace.builder.io/dispatch",
      });
    },
  );

  it("does not fall back when the configured Workspace gateway URL is invalid", async () => {
    vi.stubEnv("WORKSPACE_GATEWAY_URL", "not-a-url");
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "customer-ticket-triage",
        name: "Customer Ticket Triage",
        description: "Triage customer tickets",
        path: "/customer-ticket-triage",
        url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
        isDispatch: false,
      },
    ]);

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "https://beta.dispatch.agent-native.com",
        },
        () =>
          createWorkspaceSsoEmbedSession({
            app: "customer-ticket-triage",
            path: "/",
            chrome: "minimal",
          }),
      ),
    ).rejects.toThrow();
    expect(mocks.managerConstructor).not.toHaveBeenCalled();
  });

  it("rejects unsupported Workspace gateway schemes before beta projection", async () => {
    vi.stubEnv("A2A_SECRET", "test-a2a-secret");
    vi.stubEnv(
      "WORKSPACE_GATEWAY_URL",
      "ftp://agent-workspace.builder.io/dispatch",
    );
    vi.stubEnv("APP_BASE_PATH", "");
    vi.stubEnv("VITE_APP_BASE_PATH", "");
    const workspaceApp = {
      id: "customer-ticket-triage",
      name: "Customer Ticket Triage",
      description: "Triage customer tickets",
      path: "/customer-ticket-triage",
      url: "https://beta.agent-workspace.builder.io/dispatch/apps/customer-ticket-triage",
      isDispatch: false,
    };
    mocks.listWorkspaceApps.mockResolvedValue([workspaceApp]);
    mocks.discoverAgents.mockResolvedValue([
      {
        id: workspaceApp.id,
        name: workspaceApp.name,
        description: workspaceApp.description,
        url: workspaceApp.url,
        color: "#14B8A6",
      },
    ]);

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "https://beta.dispatch.agent-native.com",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: workspaceApp.id,
            path: "/",
            chrome: "minimal",
          }),
      ),
    ).rejects.toThrow("WORKSPACE_GATEWAY_URL must use http or https.");
    expect(mocks.signA2AToken).not.toHaveBeenCalled();
    expect(mocks.managerConstructor).not.toHaveBeenCalled();
  });

  it("rejects beta workspace SSO apps on the production lane", async () => {
    mocks.discoverAgents.mockResolvedValue([]);
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "analytics",
        name: "Analytics",
        description: "Dashboards and metrics",
        path: "/",
        url: "https://beta.analytics.agent-native.com",
        isDispatch: false,
      },
    ]);

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "https://dispatch.agent-native.com",
        },
        () =>
          createWorkspaceSsoEmbedSession({
            app: "analytics",
            path: "/overview",
          }),
      ),
    ).rejects.toThrow(/not registered/);
    expect(mocks.managerConstructor).not.toHaveBeenCalled();
  });

  it("uses a built-in home URL when discovery returns a deep agent link", async () => {
    mocks.getOrgDomain.mockResolvedValue("example.test");
    mocks.getBuiltinAgents.mockReturnValue([
      {
        id: "clips",
        name: "Clips",
        description: "Record and share",
        url: "https://clips.agent-native.com",
        color: "#000000",
      },
    ]);
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "clips",
        name: "Clips",
        description: "Record and share",
        url: "https://clips.agent-native.com/share/deep-link",
        color: "#000000",
      },
    ]);
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl:
          "https://clips.agent-native.com/_agent-native/embed/start?ticket=remote",
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "https://dispatch.agent-native.com",
      },
      () =>
        createWorkspaceSsoEmbedSession({
          app: "clips",
          path: "/inbox",
        }),
    );

    expect(mocks.managerCallTool).toHaveBeenCalledWith(
      "mcp__target__create_embed_session",
      {
        url: "https://clips.agent-native.com/inbox",
        chrome: "full",
      },
    );
    expect(mocks.managerConstructor).toHaveBeenCalledWith({
      servers: {
        target: expect.objectContaining({
          url: "https://clips.agent-native.com/mcp",
          headers: {
            Authorization: "Bearer signed-token",
            "x-agent-native-mcp-inline-apps": "1",
          },
        }),
      },
    });
    expect(mocks.signA2AToken).toHaveBeenCalledWith(
      "owner@example.test",
      "example.test",
      undefined,
      expect.objectContaining({
        audience: "https://clips.agent-native.com/mcp",
        extraClaims: {
          jti: expect.any(String),
          scope: "mcp-connect",
          agent_native_first_party_mcp: true,
        },
      }),
    );
    expect(result).toMatchObject({
      app: "clips",
      startUrl:
        "https://clips.agent-native.com/_agent-native/embed/start?ticket=remote",
    });

    mocks.getOrgDomain.mockResolvedValue(null);
    mocks.managerConstructor.mockClear();
    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          orgId: "org-1",
          requestOrigin: "https://dispatch.agent-native.com",
        },
        () => createWorkspaceSsoEmbedSession({ app: "clips", path: "/" }),
      ),
    ).rejects.toThrow("Workspace organization domain is unavailable.");
    expect(mocks.managerConstructor).not.toHaveBeenCalled();
  });

  it("uses an external agent origin as the home fallback for deep registrations", async () => {
    vi.stubEnv(
      "IDENTITY_SSO_APP_REGISTRY_JSON",
      JSON.stringify([
        {
          appId: "custom-agent",
          clientId: "custom-agent-client",
          origin: "https://custom.example.com",
          callbackPath: "/_agent-native/identity/callback",
          capabilities: ["identity-sso"],
        },
      ]),
    );
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "custom-agent",
        name: "Custom agent",
        description: "Deep endpoint",
        url: "https://custom.example.com/agent/deep-link",
        color: "#000000",
      },
    ]);
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl:
          "https://custom.example.com/_agent-native/embed/start?ticket=remote",
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://dispatch.agent-native.com",
      },
      () =>
        createWorkspaceSsoEmbedSession({
          app: "custom-agent",
          path: "/home",
        }),
    );

    expect(mocks.managerCallTool).toHaveBeenCalledWith(
      "mcp__target__create_embed_session",
      {
        url: "https://custom.example.com/home",
        chrome: "full",
      },
    );
    expect(mocks.managerConstructor).toHaveBeenCalledWith({
      servers: {
        target: expect.objectContaining({
          headers: {
            Authorization: "Bearer signed-token",
            "x-agent-native-mcp-inline-apps": "1",
          },
        }),
      },
    });
    expect(mocks.signA2AToken).toHaveBeenCalledWith(
      "owner@example.test",
      undefined,
      undefined,
      expect.objectContaining({
        audience: "https://custom.example.com/mcp",
        preferGlobalSecret: true,
        extraClaims: {
          jti: expect.any(String),
          scope: "mcp-connect",
          agent_native_first_party_mcp: true,
        },
      }),
    );
    expect(result.app).toBe("custom-agent");
  });

  it("excludes path-mounted apps from SSO while retaining canonical apps", async () => {
    vi.stubEnv("WORKSPACE_GATEWAY_URL", "https://agent-workspace.builder.io");
    mocks.discoverAgents.mockResolvedValue([
      {
        ...analyticsAgent,
        url: "https://analytics.agent-native.com",
      },
    ]);
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl:
          "https://analytics.agent-native.com/_agent-native/embed/start?ticket=remote",
      },
    });
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "atlas",
        name: "Atlas",
        description: "Workspace app",
        path: "/atlas",
        url: "https://agent-workspace.builder.io/atlas",
        isDispatch: false,
        audience: "internal",
        publicPaths: [],
        protectedPaths: [],
      },
    ]);

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "https://dispatch.agent-native.com",
        },
        () =>
          createWorkspaceSsoEmbedSession({
            app: "atlas",
            path: "/",
          }),
      ),
    ).rejects.toThrow(/not registered/);

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://dispatch.agent-native.com",
      },
      () =>
        createWorkspaceSsoEmbedSession({
          app: "analytics",
          path: "/overview",
        }),
    );

    expect(result.app).toBe("analytics");
    expect(mocks.managerConstructor).toHaveBeenCalled();
  });

  it("allows an exact custom registry entry and rejects an unregistered external app", async () => {
    vi.stubEnv(
      "IDENTITY_SSO_APP_REGISTRY_JSON",
      JSON.stringify([
        {
          appId: "workspace",
          clientId: "workspace-client",
          origin: "https://workspace.example.com",
          callbackPath: "/_agent-native/identity/callback",
          capabilities: ["identity-sso"],
        },
      ]),
    );
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "workspace",
        name: "Workspace",
        description: "Custom workspace app",
        url: "https://workspace.example.com",
        color: "#111827",
      },
      {
        id: "unregistered",
        name: "Unregistered",
        description: "External app without registration",
        url: "https://unregistered.example.com",
        color: "#111827",
      },
    ]);
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl:
          "https://workspace.example.com/_agent-native/embed/start?ticket=remote",
      },
    });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "https://dispatch.agent-native.com",
        },
        () =>
          createWorkspaceSsoEmbedSession({
            app: "workspace",
            path: "/home",
          }),
      ),
    ).resolves.toMatchObject({ app: "workspace" });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "https://dispatch.agent-native.com",
        },
        () =>
          createWorkspaceSsoEmbedSession({
            app: "unregistered",
            path: "/home",
          }),
      ),
    ).rejects.toThrow(/not registered/);
  });

  it("rejects traversal into Dispatch-owned embed routes on sibling apps", async () => {
    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/../dispatch/extensions/ext-1",
          }),
      ),
    ).rejects.toThrow(/safe app-relative route/);
  });

  it("resolves target-relative embed start URLs against the granted app", async () => {
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl: "/_agent-native/embed/start?ticket=relative",
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "analytics",
          path: "/overview",
          chrome: "minimal",
        }),
    );

    expect(result.startUrl).toBe(
      "http://localhost:8086/_agent-native/embed/start?ticket=relative",
    );
  });

  it("rejects cross-origin embed start URLs from a granted app", async () => {
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl: "https://attacker.example/steal?ticket=remote",
      },
    });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/overview",
            chrome: "minimal",
          }),
      ),
    ).rejects.toThrow(/invalid embed start URL/);
  });

  it("rejects a URL that does not belong to the explicitly named app", async () => {
    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            url: "https://mail.example.com/inbox",
          }),
      ),
    ).rejects.toThrow(
      /Embed URL must belong to an app granted through Dispatch/,
    );
  });

  it("routes same-origin mounted app embed URLs to the mounted app", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        ...analyticsAgent,
        url: "http://localhost:8092/analytics",
      },
    ]);
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl:
          "http://localhost:8092/analytics/_agent-native/embed/start?ticket=remote",
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          url: "http://localhost:8092/analytics/dashboards?range=30d",
        }),
    );

    expect(mocks.createEmbedSessionTicket).not.toHaveBeenCalled();
    expect(mocks.managerConstructor).toHaveBeenCalledWith({
      servers: {
        target: expect.objectContaining({
          url: "http://localhost:8092/analytics/mcp",
        }),
      },
    });
    expect(mocks.managerCallTool).toHaveBeenCalledWith(
      "mcp__target__create_embed_session",
      {
        url: "http://localhost:8092/analytics/dashboards?range=30d",
        chrome: "full",
      },
    );
    expect(result).toEqual({
      app: "analytics",
      startUrl:
        "http://localhost:8092/analytics/_agent-native/embed/start?ticket=remote",
    });
  });

  it("skips malformed granted app URLs when matching embed URLs", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "bad-url",
        name: "Bad URL",
        description: "Invalid manifest URL",
        url: "mail.agent-native.com",
        color: "#111827",
      },
      {
        id: "mail",
        name: "Mail",
        description: "Mail",
        url: "https://mail.agent-native.com",
        color: "#2563EB",
      },
    ]);
    mocks.managerCallTool.mockResolvedValueOnce({
      structuredContent: {
        startUrl:
          "https://mail.agent-native.com/_agent-native/embed/start?ticket=remote",
      },
    });

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          url: "https://mail.agent-native.com/inbox",
        }),
    );

    expect(mocks.managerConstructor).toHaveBeenCalledWith({
      servers: {
        target: expect.objectContaining({
          url: "https://mail.agent-native.com/mcp",
        }),
      },
    });
    expect(result).toEqual({
      app: "mail",
      startUrl:
        "https://mail.agent-native.com/_agent-native/embed/start?ticket=remote",
    });
  });

  it("does not send the source app's local org ID to the target", async () => {
    mocks.getOrgDomain.mockResolvedValue("builder.io");

    await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "analytics",
          path: "/dashboards",
        }),
    );

    expect(mocks.signA2AToken).toHaveBeenCalledWith(
      "owner@example.test",
      undefined,
      undefined,
      {
        expiresIn: "5m",
        audience: "http://localhost:8086/mcp",
        preferGlobalSecret: true,
      },
    );
    expect(mocks.signA2AOrganizationToken).not.toHaveBeenCalled();
    expect(mocks.getOrgDomain).toHaveBeenCalledWith("org-1");
    expect(mocks.getOrgA2ASecret).not.toHaveBeenCalled();
    expect(mocks.managerConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        servers: {
          target: expect.objectContaining({
            headers: {
              Authorization: "Bearer signed-token",
              "x-agent-native-mcp-inline-apps": "1",
            },
          }),
        },
      }),
    );
  });

  it("uses a user delegation token when only the org secret is configured", async () => {
    vi.stubEnv("A2A_SECRET", "");
    mocks.getOrgDomain.mockResolvedValue("builder.io");
    mocks.getOrgA2ASecret.mockResolvedValue("org-specific-secret");

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "analytics",
          path: "/dashboards",
        }),
    );

    expect(mocks.signA2AToken).not.toHaveBeenCalled();
    expect(mocks.signA2AOrgMemberDelegationToken).toHaveBeenCalledWith(
      "owner@example.test",
      "builder.io",
      "org-specific-secret",
      "http://localhost:8086/mcp",
    );
    expect(mocks.signA2AOrganizationToken).not.toHaveBeenCalled();
    expect(result.startUrl).toBe(
      "http://localhost:8086/_agent-native/embed/start?ticket=remote",
    );
    expect(mocks.managerConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        servers: {
          target: expect.objectContaining({
            headers: {
              Authorization: "Bearer org-member-token",
              "x-agent-native-mcp-inline-apps": "1",
            },
          }),
        },
      }),
    );
  });

  it("tries org-member delegation after a deployment-token auth rejection", async () => {
    mocks.getOrgDomain.mockResolvedValue("builder.io");
    mocks.getOrgA2ASecret.mockResolvedValue("org-specific-secret");
    mocks.signA2AToken.mockResolvedValue("deployment-user-token");
    mocks.signA2AOrgMemberDelegationToken.mockResolvedValue("org-member-token");
    mocks.managerGetConnectErrorStatus.mockReturnValueOnce(401);

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "analytics",
          path: "/dashboards",
        }),
    );

    expect(result.startUrl).toBe(
      "http://localhost:8086/_agent-native/embed/start?ticket=remote",
    );
    expect(mocks.managerConstructor).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        servers: {
          target: expect.objectContaining({
            headers: {
              Authorization: "Bearer deployment-user-token",
              "x-agent-native-mcp-inline-apps": "1",
            },
          }),
        },
      }),
    );
    expect(mocks.managerConstructor).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        servers: {
          target: expect.objectContaining({
            headers: {
              Authorization: "Bearer org-member-token",
              "x-agent-native-mcp-inline-apps": "1",
            },
          }),
        },
      }),
    );
    expect(mocks.managerCallTool).toHaveBeenCalledTimes(1);
    expect(mocks.signA2AOrgMemberDelegationToken).toHaveBeenCalledWith(
      "owner@example.test",
      "builder.io",
      "org-specific-secret",
      "http://localhost:8086/mcp",
    );
  });

  it("uses member delegation when the org secret matches the source deployment secret", async () => {
    vi.stubEnv("A2A_SECRET", "source-deployment-secret");
    mocks.getOrgDomain.mockResolvedValue("builder.io");
    mocks.getOrgA2ASecret.mockResolvedValue("source-deployment-secret");
    mocks.managerGetConnectErrorStatus.mockReturnValueOnce(401);

    const result = await runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "http://localhost:8092",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "analytics",
          path: "/dashboards",
        }),
    );

    expect(result.startUrl).toBe(
      "http://localhost:8086/_agent-native/embed/start?ticket=remote",
    );
    expect(mocks.managerConstructor).toHaveBeenCalledTimes(2);
    expect(mocks.signA2AOrgMemberDelegationToken).toHaveBeenCalledWith(
      "owner@example.test",
      "builder.io",
      "source-deployment-secret",
      "http://localhost:8086/mcp",
    );
  });

  it("does not treat a bare status number in an error message as an auth refusal", async () => {
    vi.stubEnv("A2A_SECRET", "source-deployment-secret");
    mocks.getOrgDomain.mockResolvedValue("builder.io");
    mocks.getOrgA2ASecret.mockResolvedValue("org-specific-secret");
    mocks.managerStart.mockRejectedValueOnce(
      new Error(
        "MCP response body mentions reference 403 from an unrelated request",
      ),
    );

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          orgId: "org-1",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/dashboards",
          }),
      ),
    ).rejects.toThrow(/reference 403 from an unrelated request/);

    expect(mocks.managerConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.signA2AOrgMemberDelegationToken).not.toHaveBeenCalled();
    expect(mocks.getOrgA2ASecret).not.toHaveBeenCalled();
  });

  it("does not retry an action-level authorization error with member delegation", async () => {
    mocks.getOrgDomain.mockResolvedValue("builder.io");
    mocks.getOrgA2ASecret.mockResolvedValue("org-specific-secret");
    mocks.managerCallTool.mockRejectedValueOnce(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          orgId: "org-1",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/dashboards",
          }),
      ),
    ).rejects.toThrow("Forbidden");

    expect(mocks.managerConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.signA2AOrgMemberDelegationToken).not.toHaveBeenCalled();
    expect(mocks.getOrgA2ASecret).not.toHaveBeenCalled();
  });

  it("does not retry an authenticated-caller error with an org principal", async () => {
    mocks.managerCallTool.mockResolvedValueOnce({
      isError: true,
      content: [
        {
          type: "text",
          text: "Error: create_embed_session requires an authenticated MCP caller.",
        },
      ],
    });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          orgId: "org-1",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/dashboards",
          }),
      ),
    ).rejects.toThrow(/authenticated MCP caller/);

    expect(mocks.managerConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.managerCallTool).toHaveBeenCalledTimes(1);
    expect(mocks.signA2AOrganizationToken).not.toHaveBeenCalled();
  });

  it("does not retry permanent target MCP errors", async () => {
    mocks.managerCallTool.mockRejectedValueOnce(
      new Error(
        'MCP server "target" is not connected: The MCP server rejected the request.',
      ),
    );

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/dashboards",
          }),
      ),
    ).rejects.toThrow(/rejected the request/);
    expect(mocks.managerConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.managerCallTool).toHaveBeenCalledTimes(1);
  });

  it("does not let stop failures mask target MCP errors", async () => {
    mocks.managerCallTool.mockRejectedValueOnce(
      new Error("Target app returned a permanent auth error."),
    );
    mocks.managerStop.mockRejectedValueOnce(new Error("stop failed"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/dashboards",
          }),
      ),
    ).rejects.toThrow(/permanent auth error/);
    expect(warnSpy).toHaveBeenCalledWith(
      "[dispatch] Failed to stop target MCP client:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("surfaces target MCP embed-session errors", async () => {
    mocks.managerCallTool.mockResolvedValueOnce({
      isError: true,
      content: [
        {
          type: "text",
          text: "Error: create_embed_session requires an authenticated MCP caller.",
        },
      ],
    });

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          requestOrigin: "http://localhost:8092",
        },
        () =>
          createGrantedDispatchMcpEmbedSession({
            app: "analytics",
            path: "/dashboards",
          }),
      ),
    ).rejects.toThrow(/authenticated MCP caller/);
    expect(mocks.managerConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.managerCallTool).toHaveBeenCalledTimes(1);
    expect(mocks.signA2AOrganizationToken).not.toHaveBeenCalled();
  });
});

it("accepts chat credentials only over the private MCP handoff and signs dedicated first-party authority", async () => {
  vi.stubEnv("A2A_SECRET", "test-a2a-secret");
  mocks.discoverAgents.mockResolvedValue([
    { ...analyticsAgent, url: "https://analytics.agent-native.com" },
  ]);
  mocks.managerCallTool.mockResolvedValue({
    structuredContent: {
      runtime: "workspace-app-chat",
      token: "private-chat-credential",
      targetPath: "/",
      expiresAt: Date.now() + 900000,
    },
  });
  const anchor = Date.now() - 1000;
  const result = await runWithRequestContext(
    {
      userEmail: "owner@example.test",
      requestOrigin: "https://dispatch.agent-native.com",
      identityAuthenticatedAtMs: anchor,
    },
    () => createWorkspaceSsoEmbedSessionForWorkspaceAppChat("analytics"),
  );
  expect(result).toMatchObject({
    token: "private-chat-credential",
    appBaseUrl: "https://analytics.agent-native.com",
  });
  expect(result).not.toHaveProperty("startUrl");
  expect(mocks.signA2AToken).toHaveBeenCalledWith(
    "owner@example.test",
    undefined,
    undefined,
    expect.objectContaining({
      extraClaims: expect.objectContaining({
        agent_native_first_party_mcp: true,
        agent_native_workspace_app_chat: true,
        agent_native_chat_grant_issued_at_ms: anchor,
      }),
    }),
  );
});

it.each([
  ["missing deployment credential", "", undefined],
  ["rejected deployment credential", "test-a2a-secret", 401],
] as const)(
  "never downgrades chat authority to an organization-member token: %s",
  async (_name, deploymentSecret, status) => {
    vi.stubEnv("A2A_SECRET", deploymentSecret);
    mocks.discoverAgents.mockResolvedValue([
      { ...analyticsAgent, url: "https://analytics.agent-native.com" },
    ]);
    mocks.getOrgDomain.mockResolvedValue("example.test");
    mocks.getOrgA2ASecret.mockResolvedValue("organization-test-secret");
    mocks.managerGetConnectErrorStatus.mockReturnValue(status);
    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          orgId: "org-one",
          requestOrigin: "https://dispatch.agent-native.com",
          identityAuthenticatedAtMs: Date.now() - 1000,
        },
        () => createWorkspaceSsoEmbedSessionForWorkspaceAppChat("analytics"),
      ),
    ).rejects.toThrow();
    expect(mocks.getOrgA2ASecret).not.toHaveBeenCalled();
    expect(mocks.signA2AOrgMemberDelegationToken).not.toHaveBeenCalled();
  },
);

it("refuses private chat credentials on the public browser document wrapper", async () => {
  vi.stubEnv("A2A_SECRET", "test-a2a-secret");
  mocks.discoverAgents.mockResolvedValue([
    { ...analyticsAgent, url: "https://analytics.agent-native.com" },
  ]);
  mocks.managerCallTool.mockResolvedValue({
    structuredContent: {
      runtime: "workspace-app-chat",
      token: "private-chat-credential",
      targetPath: "/",
      expiresAt: Date.now() + 900000,
    },
  });
  await expect(
    runWithRequestContext(
      {
        userEmail: "owner@example.test",
        requestOrigin: "https://dispatch.agent-native.com",
        identityAuthenticatedAtMs: Date.now() - 1000,
      },
      () => createWorkspaceSsoEmbedSession({ app: "analytics", path: "/" }),
    ),
  ).rejects.toThrow("embed start URL");
});

it("resolves both document and chat trust from the application config layer ahead of env", async () => {
  vi.stubEnv("A2A_SECRET", "test-a2a-secret");
  vi.stubEnv("IDENTITY_SSO_APP_REGISTRY_JSON", "[]");
  // The app layer has precedence over the environment; both runtime paths must honor it.
  defineAppConfig({
    auth: {
      identitySsoAppRegistryJson: JSON.stringify([
        {
          appId: "workspace",
          clientId: "workspace-client",
          origin: "https://workspace.example.com",
          callbackPath: "/_agent-native/identity/callback",
          capabilities: ["identity-sso"],
        },
      ]),
    },
  } as Parameters<typeof defineAppConfig>[0]);
  mocks.discoverAgents.mockResolvedValue([
    {
      ...analyticsAgent,
      id: "workspace",
      name: "Workspace",
      url: "https://workspace.example.com",
    },
  ]);
  mocks.managerCallTool.mockResolvedValueOnce({
    structuredContent: {
      startUrl:
        "https://workspace.example.com/_agent-native/embed/start?ticket=remote",
    },
  });
  const context = {
    userEmail: "owner@example.test",
    requestOrigin: "https://dispatch.agent-native.com",
    identityAuthenticatedAtMs: Date.now() - 1000,
  };
  const document = await runWithRequestContext(context, () =>
    createWorkspaceSsoEmbedSession({ app: "workspace", path: "/" }),
  );
  expect(document.startUrl).toContain("https://workspace.example.com/");
  expect(mocks.signA2AToken).toHaveBeenCalledWith(
    "owner@example.test",
    undefined,
    undefined,
    expect.objectContaining({
      audience: "https://workspace.example.com/mcp",
      preferGlobalSecret: true,
      extraClaims: {
        jti: expect.any(String),
        scope: "mcp-connect",
        agent_native_first_party_mcp: true,
      },
    }),
  );
  mocks.managerCallTool.mockResolvedValueOnce({
    structuredContent: {
      runtime: "workspace-app-chat",
      token: "private-chat-credential",
      targetPath: "/",
      expiresAt: Date.now() + 900000,
    },
  });
  const chat = await runWithRequestContext(context, () =>
    createWorkspaceSsoEmbedSessionForWorkspaceAppChat("workspace"),
  );
  expect(chat).toMatchObject({
    token: "private-chat-credential",
    appBaseUrl: "https://workspace.example.com",
  });
  expect(chat).not.toHaveProperty("startUrl");
});

it("grants first-party MCP claims for granted document embeds to canonical workspace apps", async () => {
  vi.stubEnv("A2A_SECRET", "test-a2a-secret");
  mocks.getOrgDomain.mockResolvedValue("example.test");
  mocks.discoverAgents.mockResolvedValue([
    { ...analyticsAgent, url: "https://analytics.agent-native.com" },
  ]);
  mocks.getUserSetting.mockResolvedValue({ mode: "all-apps" });
  mocks.managerCallTool.mockResolvedValueOnce({
    structuredContent: {
      startUrl:
        "https://analytics.agent-native.com/_agent-native/embed/start?ticket=remote",
    },
  });

  const result = await runWithRequestContext(
    {
      userEmail: "owner@example.test",
      orgId: "org-1",
      requestOrigin: "https://dispatch.agent-native.com",
    },
    () =>
      createGrantedDispatchMcpEmbedSession({
        app: "analytics",
        path: "/dashboards",
      }),
  );

  expect(result.startUrl).toBe(
    "https://analytics.agent-native.com/_agent-native/embed/start?ticket=remote",
  );
  expect(mocks.signA2AToken).toHaveBeenCalledWith(
    "owner@example.test",
    "example.test",
    undefined,
    expect.objectContaining({
      audience: "https://analytics.agent-native.com/mcp",
      preferGlobalSecret: true,
      extraClaims: {
        jti: expect.any(String),
        scope: "mcp-connect",
        agent_native_first_party_mcp: true,
      },
    }),
  );

  mocks.getOrgDomain.mockResolvedValue(null);
  mocks.managerConstructor.mockClear();
  await expect(
    runWithRequestContext(
      {
        userEmail: "owner@example.test",
        orgId: "org-1",
        requestOrigin: "https://dispatch.agent-native.com",
      },
      () =>
        createGrantedDispatchMcpEmbedSession({
          app: "analytics",
          path: "/",
        }),
    ),
  ).rejects.toThrow("Workspace organization domain is unavailable.");
  expect(mocks.managerConstructor).not.toHaveBeenCalled();
});

it("grants first-party MCP claims for granted document embeds to SSO-registered mounted targets", async () => {
  vi.stubEnv("A2A_SECRET", "test-a2a-secret");
  vi.stubEnv("WORKSPACE_GATEWAY_URL", "https://labs.agent-native.com");
  vi.stubEnv("APP_BASE_PATH", "/dispatch");
  vi.stubEnv("VITE_APP_BASE_PATH", "");
  mocks.getOrgDomain.mockResolvedValue("example.test");
  defineAppConfig({
    auth: {
      identitySsoAppRegistryJson: JSON.stringify([
        {
          appId: "analytics-2",
          clientId: "labs-analytics-2",
          origin: "https://labs.agent-native.com",
          callbackPath: "/_agent-native/identity/callback",
          capabilities: ["identity-sso"],
        },
      ]),
    },
  } as Parameters<typeof defineAppConfig>[0]);
  const mountedAnalytics = {
    id: "analytics-2",
    name: "Analytics",
    description: "Analytics workspace app",
    path: "/analytics-2",
    url: "https://labs.agent-native.com/analytics-2",
    isDispatch: false,
  };
  mocks.listWorkspaceApps.mockResolvedValue([mountedAnalytics]);
  mocks.discoverAgents.mockResolvedValue([
    {
      id: mountedAnalytics.id,
      name: mountedAnalytics.name,
      description: mountedAnalytics.description,
      url: mountedAnalytics.url,
      color: "#14B8A6",
    },
  ]);
  mocks.getUserSetting.mockResolvedValue({ mode: "all-apps" });
  mocks.managerCallTool.mockResolvedValueOnce({
    structuredContent: {
      startUrl:
        "https://labs.agent-native.com/analytics-2/_agent-native/embed/start?ticket=remote",
    },
  });

  const result = await runWithRequestContext(
    {
      userEmail: "owner@example.test",
      orgId: "org-1",
      requestOrigin: "https://labs.agent-native.com",
    },
    () =>
      createGrantedDispatchMcpEmbedSession({
        app: "analytics-2",
        path: "/",
      }),
  );

  expect(result.startUrl).toBe(
    "https://labs.agent-native.com/analytics-2/_agent-native/embed/start?ticket=remote",
  );
  expect(mocks.managerConstructor).toHaveBeenCalledWith(
    expect.objectContaining({
      servers: {
        target: expect.objectContaining({
          url: "https://labs.agent-native.com/analytics-2/mcp",
          headers: {
            Authorization: "Bearer signed-token",
            "x-agent-native-mcp-inline-apps": "1",
          },
        }),
      },
    }),
  );
  expect(mocks.signA2AToken).toHaveBeenCalledWith(
    "owner@example.test",
    "example.test",
    undefined,
    expect.objectContaining({
      audience: "https://labs.agent-native.com/analytics-2/mcp",
      preferGlobalSecret: true,
      extraClaims: {
        jti: expect.any(String),
        scope: "mcp-connect",
        agent_native_first_party_mcp: true,
      },
    }),
  );
});

it("withholds first-party MCP claims for granted document embeds to unregistered targets even on the same origin", async () => {
  vi.stubEnv("A2A_SECRET", "test-a2a-secret");
  vi.stubEnv("WORKSPACE_GATEWAY_URL", "https://labs.agent-native.com");
  vi.stubEnv("APP_BASE_PATH", "/dispatch");
  vi.stubEnv("VITE_APP_BASE_PATH", "");
  vi.stubEnv("IDENTITY_SSO_APP_REGISTRY_JSON", "[]");
  mocks.getOrgDomain.mockResolvedValue("example.test");
  const unregisteredMounted = {
    id: "analytics-2",
    name: "Analytics",
    description: "Analytics workspace app",
    path: "/analytics-2",
    url: "https://labs.agent-native.com/analytics-2",
    isDispatch: false,
  };
  mocks.listWorkspaceApps.mockResolvedValue([unregisteredMounted]);
  mocks.discoverAgents.mockResolvedValue([
    {
      id: unregisteredMounted.id,
      name: unregisteredMounted.name,
      description: unregisteredMounted.description,
      url: unregisteredMounted.url,
      color: "#14B8A6",
    },
  ]);
  mocks.getUserSetting.mockResolvedValue({ mode: "all-apps" });
  mocks.managerCallTool.mockResolvedValueOnce({
    structuredContent: {
      startUrl:
        "https://labs.agent-native.com/analytics-2/_agent-native/embed/start?ticket=remote",
    },
  });

  await runWithRequestContext(
    {
      userEmail: "owner@example.test",
      orgId: "org-1",
      requestOrigin: "https://labs.agent-native.com",
    },
    () =>
      createGrantedDispatchMcpEmbedSession({
        app: "analytics-2",
        path: "/",
      }),
  );

  expect(mocks.signA2AToken).toHaveBeenCalledWith(
    "owner@example.test",
    undefined,
    undefined,
    expect.not.objectContaining({ extraClaims: expect.anything() }),
  );

  mocks.signA2AToken.mockClear();
  mocks.listWorkspaceApps.mockResolvedValue([]);
  mocks.discoverAgents.mockResolvedValue([
    {
      id: "third-party-agent",
      name: "Third Party Agent",
      description: "External unregistered app",
      url: "https://third-party.example.com",
      color: "#000000",
    },
  ]);
  mocks.managerCallTool.mockResolvedValueOnce({
    structuredContent: {
      startUrl:
        "https://third-party.example.com/_agent-native/embed/start?ticket=remote",
    },
  });

  await runWithRequestContext(
    {
      userEmail: "owner@example.test",
      orgId: "org-1",
      requestOrigin: "https://labs.agent-native.com",
    },
    () =>
      createGrantedDispatchMcpEmbedSession({
        app: "third-party-agent",
        path: "/",
      }),
  );

  expect(mocks.signA2AToken).toHaveBeenCalledWith(
    "owner@example.test",
    undefined,
    undefined,
    expect.not.objectContaining({ extraClaims: expect.anything() }),
  );
});

describe("A2A tab/viewport propagation, double-prefix prevention, and manifest v2 open_app validation", () => {
  afterEach(() => {
    clearGrantedAppManifestCache();
  });

  it("forwards childBrowserTabId and foreground viewportMode on ask_app when the target app is bound in the pane", async () => {
    mocks.resolveChildBrowserTab.mockResolvedValueOnce(
      "a1b2c3d4-5678-4abc-9def-1234567890ab",
    );
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-tab-1",
      status: {
        state: "completed",
        message: { role: "agent", parts: [{ type: "text", text: "opened" }] },
        timestamp: "2026-11-23T00:00:00Z",
      },
    });

    await runWithRequestContext(
      { userEmail: "owner@example.test", orgId: "org-1" },
      () => askGrantedDispatchMcpApp("analytics", "switch to revenue"),
    );

    expect(mocks.a2aConstructor).toHaveBeenCalledWith(
      analyticsAgent.url,
      undefined,
      expect.objectContaining({
        transportHeaders: {
          "x-agent-native-browser-tab": "a1b2c3d4-5678-4abc-9def-1234567890ab",
          "x-agent-native-viewport-mode": "foreground",
        },
      }),
    );
    expect(mocks.a2aSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          browserTabId: "a1b2c3d4-5678-4abc-9def-1234567890ab",
          viewportMode: "foreground",
        }),
      }),
    );
  });

  it("forwards viewportMode=background on ask_app without binding the foreground child tab", async () => {
    mocks.a2aSend.mockResolvedValueOnce({
      id: "task-bg-1",
      status: {
        state: "completed",
        message: { role: "agent", parts: [{ type: "text", text: "found" }] },
        timestamp: "2026-11-23T00:00:00Z",
      },
    });

    await runWithRequestContext(
      { userEmail: "owner@example.test", orgId: "org-1" },
      () =>
        askGrantedDispatchMcpApp("analytics", "look up metric", {
          viewportMode: "background",
        }),
    );

    expect(mocks.resolveChildBrowserTab).not.toHaveBeenCalled();
    expect(mocks.a2aConstructor).toHaveBeenCalledWith(
      analyticsAgent.url,
      undefined,
      expect.objectContaining({
        transportHeaders: {
          "x-agent-native-viewport-mode": "background",
        },
      }),
    );
    expect(mocks.a2aSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          viewportMode: "background",
        }),
      }),
    );
  });

  it("prevents /<app>/<app> double base-path prefixing in appHomeBaseUrl, joinAppBaseUrlAndPath, and open_app", async () => {
    expect(
      appHomeBaseUrl({
        url: "https://workspace.example.test/decks-2/decks-2",
      }),
    ).toBe("https://workspace.example.test/decks-2");
    expect(
      joinAppBaseUrlAndPath(
        "https://workspace.example.test/decks-2",
        "/decks-2",
      ),
    ).toBe("https://workspace.example.test/decks-2/");
    expect(
      joinAppBaseUrlAndPath(
        "https://workspace.example.test/decks-2",
        "/decks-2/docs/deck-1?slide=2",
      ),
    ).toBe("https://workspace.example.test/decks-2/docs/deck-1?slide=2");

    mocks.discoverAgents.mockResolvedValue([
      {
        id: "decks-2",
        name: "Decks",
        description: "Slide decks",
        url: "https://workspace.example.test/decks-2",
        color: "#222222",
      },
    ]);
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "decks-2",
        name: "Decks",
        path: "/decks-2",
        url: "https://workspace.example.test/decks-2",
      },
    ]);

    const result = await runWithRequestContext(
      { userEmail: "owner@example.test", orgId: "org-1" },
      () =>
        openGrantedDispatchMcpApp({
          app: "decks-2",
          path: "/decks-2/docs/q4",
          focus: true,
        }),
    );

    expect(result.url).toBe("https://workspace.example.test/decks-2/docs/q4");
    expect(result.focus).toBe(true);
  });

  it("validates open_app routes and expands { screen, params } against a v2 manifest", async () => {
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "decks-2",
        name: "Decks",
        description: "Slide decks",
        url: "https://workspace.example.test/decks-2",
        color: "#222222",
      },
    ]);
    mocks.listWorkspaceApps.mockResolvedValue([
      {
        id: "decks-2",
        name: "Decks",
        path: "/decks-2",
        url: "https://workspace.example.test/decks-2",
      },
    ]);
    registerGrantedAppManifest("decks-2", {
      version: 2,
      screens: {
        home: { route: "/", action: "navigate" },
        deck: { route: "/docs/:deckId", action: "navigate" },
      },
      supportsViewOverlay: true,
    });

    const validPath = await runWithRequestContext(
      { userEmail: "owner@example.test", orgId: "org-1" },
      () =>
        openGrantedDispatchMcpApp({
          app: "decks-2",
          path: "/docs/deck-42",
        }),
    );
    expect(validPath.url).toBe(
      "https://workspace.example.test/decks-2/docs/deck-42",
    );

    const byScreen = await runWithRequestContext(
      { userEmail: "owner@example.test", orgId: "org-1" },
      () =>
        openGrantedDispatchMcpApp({
          app: "decks-2",
          screen: "deck",
          params: { deckId: "deck-42", slide: 3 },
        }),
    );
    expect(byScreen.path).toBe("/docs/deck-42");
    expect(byScreen.url).toBe(
      "https://workspace.example.test/decks-2/docs/deck-42?slide=3",
    );

    await expect(
      runWithRequestContext(
        { userEmail: "owner@example.test", orgId: "org-1" },
        () =>
          openGrantedDispatchMcpApp({
            app: "decks-2",
            path: "/totally/invalid",
          }),
      ),
    ).rejects.toThrow(
      /Invalid route "\/totally\/invalid" for app "decks-2".*deck \(\/docs\/:deckId\)/,
    );
  });
});
