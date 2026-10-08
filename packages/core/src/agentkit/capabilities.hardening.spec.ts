import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getRequestContext,
  getRequestOrgId,
  runWithRequestContext,
} from "../server/request-context.js";

const mocks = vi.hoisted(() => ({
  ready: vi.fn(),
  connection: vi.fn(),
  token: vi.fn(),
  providers: vi.fn(),
}));
vi.mock("../provider-api/index.js", () => ({
  defaultProviderApiCredentialResolver: async () => null,
  getProviderApiConfig: () => ({
    label: "Google Drive API",
    auth: {
      type: "oauth-bearer",
      workspaceProvider: "google_drive",
      oauthProvider: "google",
    },
  }),
  isProviderApiId: (id: string) => id === "google_drive",
  listProviderApiIdsForTemplateUse: mocks.providers,
}));
vi.mock("../oauth-tokens/index.js", () => ({ hasOAuthTokens: mocks.token }));
vi.mock("../workspace-connections/index.js", () => ({
  resolveWorkspaceConnectionForApp: mocks.connection,
}));
vi.mock("../server/agent-chat/mcp-glue.js", () => ({
  getMcpManagerForCurrentRequest: mocks.ready,
}));
vi.mock("../mcp-client/remote-store.js", () => ({
  parseMergedKey: (value: string) => {
    const match = /^(?:mcp__)?org_([^_]+)_([^_]+)(?:__.*)?$/.exec(value);
    return match ? { scope: "org", owner: match[1], name: match[2] } : null;
  },
  hashEmail: (email: string) => email,
}));

import {
  isAgentKitFigmaSourceAvailable,
  listAgentKitCapabilities,
  readAgentKitIntegrationIntent,
} from "./capabilities.js";

const context = { userEmail: "member@example.test", orgId: "alpha" };

function manager() {
  const servers = {
    org_alpha_tools: { type: "http", url: "https://mcp.example.test" },
    org_beta_tools: { type: "http", url: "https://mcp.example.test" },
    org_alpha_assets: {
      type: "http",
      url: "https://mcp.example.test",
      firstParty: true,
      firstPartyAppId: "assets",
    },
    org_beta_assets: {
      type: "http",
      url: "https://mcp.example.test",
      firstParty: true,
      firstPartyAppId: "assets",
    },
  };
  return {
    getConfig: () => ({ servers }),
    getStatus: () => ({ connectedServers: Object.keys(servers) }),
    getToolsForServer: (id: string) => [{ name: `mcp__${id}__read` }],
    hasServer: vi.fn().mockReturnValue(true),
  };
}

describe("AgentKit scoped readiness regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ready.mockResolvedValue(manager());
    mocks.token.mockResolvedValue(true);
    mocks.providers.mockImplementation((appId: string) =>
      appId === "slides" ? ["google_drive"] : [],
    );
    mocks.connection.mockImplementation(async () =>
      getRequestOrgId() === "alpha"
        ? {
            available: true,
            connection: {
              accountId: "example-account",
              ownerEmail: context.userEmail,
            },
          }
        : { available: false, connection: null },
    );
  });

  it.each([undefined, "org"] as const)(
    "uses the explicit credential scope %s across all capability entry points",
    async (credentialScope) => {
      const ambientScope = credentialScope === "org" ? undefined : "org";
      const observedScopes: ("org" | undefined)[] = [];
      mocks.providers.mockReturnValue(["figma", "google_drive"]);
      mocks.connection.mockImplementation(async () => {
        observedScopes.push(getRequestContext()?.credentialScope);
        return {
          available: true,
          connection: {
            accountId: "example-account",
            ownerEmail: context.userEmail,
          },
        };
      });

      await runWithRequestContext(
        { ...context, credentialScope: ambientScope },
        async () => {
          const explicitContext = { ...context, credentialScope };
          const catalog = await listAgentKitCapabilities(
            "slides",
            explicitContext,
          );
          expect(catalog.sources.figma.available).toBe(true);
          await expect(
            readAgentKitIntegrationIntent(
              "slides",
              "google_drive",
              explicitContext,
            ),
          ).resolves.not.toBeNull();
          await expect(
            isAgentKitFigmaSourceAvailable(explicitContext),
          ).resolves.toBe(true);
          expect(getRequestContext()?.credentialScope).toBe(ambientScope);
        },
      );
      expect(observedScopes).toEqual(Array(4).fill(credentialScope));
    },
  );

  it("uses the explicit scope for grants and MCP tools even under a different ambient request", async () => {
    const result = await runWithRequestContext(
      { userEmail: "other@example.test", orgId: "beta" },
      () => listAgentKitCapabilities("slides", context),
    );
    expect(result.integrations.map((entry) => entry.id)).toEqual([
      "google_drive",
      "mcp:org_alpha_tools",
      "mcp:org_alpha_assets",
    ]);
    await expect(
      readAgentKitIntegrationIntent("slides", "mcp:org_beta_tools", context),
    ).resolves.toBeNull();
    await expect(
      readAgentKitIntegrationIntent("slides", "mcp:org_alpha_tools", context),
    ).resolves.toMatchObject({
      id: "mcp:org_alpha_tools",
    });
  });

  it("allows remote Assets from Design only in the request's organization", async () => {
    const result = await listAgentKitCapabilities("design", context);
    expect(result.integrations).toContainEqual({
      id: "mcp:org_alpha_assets",
      label: "assets",
      kind: "mcp",
    });
    expect(result.integrations.map((entry) => entry.id)).not.toContain(
      "mcp:org_beta_assets",
    );
    await expect(
      readAgentKitIntegrationIntent("design", "mcp:org_alpha_assets", context),
    ).resolves.toMatchObject({ id: "mcp:org_alpha_assets" });
    await expect(
      readAgentKitIntegrationIntent("design", "mcp:org_beta_assets", context),
    ).resolves.toBeNull();
    await expect(
      readAgentKitIntegrationIntent("design", "mcp:org_alpha_assets", {
        ...context,
        orgId: "beta",
      }),
    ).resolves.toBeNull();
  });

  it("does not inherit an ambient organization for personal capability reads", async () => {
    const result = await runWithRequestContext(
      { userEmail: context.userEmail, orgId: "alpha" },
      () =>
        listAgentKitCapabilities("slides", {
          userEmail: context.userEmail,
          orgId: null,
        }),
    );
    expect(result.integrations).toEqual([]);
  });

  it("waits for MCP readiness instead of completing with an empty catalog", async () => {
    let resolve!: (value: ReturnType<typeof manager>) => void;
    mocks.ready.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    let completed = false;
    const result = listAgentKitCapabilities("design", context).then((value) => {
      completed = true;
      return value;
    });
    await vi.waitFor(() => expect(mocks.ready).toHaveBeenCalled());
    expect(completed).toBe(false);
    resolve(manager());
    expect((await result).integrations).toHaveLength(2);
  });

  it("propagates initialization failures without a successful empty result", async () => {
    mocks.ready.mockRejectedValue(new Error("MCP initialization failed"));
    await expect(listAgentKitCapabilities("design", context)).rejects.toThrow(
      "MCP initialization failed",
    );
  });

  it("rejects a revoked grant at submit time despite an earlier successful catalog", async () => {
    expect(
      (await listAgentKitCapabilities("slides", context)).integrations[0].id,
    ).toBe("google_drive");
    mocks.connection.mockResolvedValue({ available: false, connection: null });
    await expect(
      readAgentKitIntegrationIntent("slides", "google_drive", context),
    ).resolves.toBeNull();
    expect(mocks.token).toHaveBeenCalledTimes(1);
  });

  it("rejects disconnected MCP tools even if the tool metadata remains cached", async () => {
    const connected = manager();
    mocks.ready.mockResolvedValue(connected);
    await expect(
      readAgentKitIntegrationIntent("design", "mcp:org_alpha_tools", context),
    ).resolves.not.toBeNull();
    connected.hasServer.mockReturnValue(false);
    await expect(
      readAgentKitIntegrationIntent("design", "mcp:org_alpha_tools", context),
    ).resolves.toBeNull();
  });

  it("requires identity even for global tools and never returns private connection data", async () => {
    await expect(
      listAgentKitCapabilities("design", { userEmail: " " }),
    ).rejects.toThrow("authenticated user");
    expect(mocks.ready).not.toHaveBeenCalled();
    const result = await listAgentKitCapabilities("slides", context);
    expect(JSON.stringify(result)).not.toContain("example-account");
    expect(JSON.stringify(result)).not.toContain("https://mcp.example.test");
  });
});
