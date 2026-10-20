import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  hasOAuthTokens: vi.fn(),
  resolveWorkspaceConnection: vi.fn(),
  getMcpManagerForCurrentRequest: vi.fn(),
  isMcpToolAllowed: vi.fn(),
}));

vi.mock("../provider-api/index.js", () => ({
  defaultProviderApiCredentialResolver: mocks.resolve,
  getProviderApiConfig: (provider: string) => configs[provider],
  isProviderApiId: (provider: string) => provider in configs,
  listProviderApiIdsForTemplateUse: (appId: string) =>
    appId === "design"
      ? ["figma", "github"]
      : ["google_drive", "google_slides"],
}));
vi.mock("../oauth-tokens/index.js", () => ({
  hasOAuthTokens: mocks.hasOAuthTokens,
}));
vi.mock("../workspace-connections/index.js", () => ({
  resolveWorkspaceConnectionForApp: mocks.resolveWorkspaceConnection,
}));
vi.mock("../server/agent-chat/mcp-glue.js", () => ({
  getMcpManagerForCurrentRequest: mocks.getMcpManagerForCurrentRequest,
}));
vi.mock("../mcp-client/visibility.js", () => ({
  isMcpToolAllowedForRequest: mocks.isMcpToolAllowed,
}));
vi.mock("../mcp-client/remote-store.js", () => ({
  parseMergedKey: (serverId: string) => {
    const match = /^(user|org|hub)_([^_]+)_(.+)$/.exec(serverId);
    return match ? { scope: match[1], owner: match[2], name: match[3] } : null;
  },
}));

const configs: Record<string, Record<string, unknown>> = {
  figma: {
    id: "figma",
    label: "Figma REST API",
    credentialKeys: ["FIGMA_ACCESS_TOKEN"],
    auth: {
      type: "oauth-bearer-or-api-key-header",
      oauthProvider: "figma",
      tokenLabel: "Figma OAuth token",
      key: "FIGMA_ACCESS_TOKEN",
      header: "X-Figma-Token",
      workspaceProvider: "figma",
    },
  },
  github: {
    id: "github",
    label: "GitHub REST API",
    credentialKeys: ["GITHUB_TOKEN"],
    auth: {
      type: "oauth-bearer-or-bearer-key",
      oauthProvider: "github",
      tokenLabel: "GitHub OAuth token",
      key: "GITHUB_TOKEN",
      workspaceProvider: "github",
    },
  },
  google_drive: {
    id: "google_drive",
    label: "Google Drive API",
    credentialKeys: ["GOOGLE_OAUTH_ACCOUNT"],
    auth: {
      type: "oauth-bearer",
      oauthProvider: "google",
      tokenLabel: "Google OAuth token",
      workspaceProvider: "google_drive",
    },
  },
  google_slides: {
    id: "google_slides",
    label: "Google Slides API",
    credentialKeys: ["GOOGLE_OAUTH_ACCOUNT"],
    auth: {
      type: "oauth-bearer",
      oauthProvider: "google",
      tokenLabel: "Google OAuth token",
      workspaceProvider: "google_drive",
    },
  },
};

import {
  isAgentKitFigmaSourceAvailable,
  listAgentKitCapabilities,
  readAgentKitIntegrationIntent,
} from "./capabilities.js";

describe("AgentKit integration capabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveWorkspaceConnection.mockImplementation(
      async ({ provider, appId }) =>
        provider === "google_drive" && appId === "slides"
          ? {
              available: true,
              connection: {
                accountId: "google-account",
                ownerEmail: "member@example.test",
              },
            }
          : { available: false, connection: null },
    );
    mocks.hasOAuthTokens.mockImplementation(
      async (provider, owner, accountId) =>
        provider === "google" &&
        owner === "member@example.test" &&
        accountId === "google-account",
    );
    mocks.getMcpManagerForCurrentRequest.mockResolvedValue({
      getConfig: () => ({ servers: {} }),
      getStatus: () => ({ connectedServers: [] }),
      getToolsForServer: () => [],
      hasServer: () => false,
    });
    mocks.isMcpToolAllowed.mockReturnValue(true);
    mocks.resolve.mockImplementation(async ({ appId, provider, key }) => {
      const configured = new Set([
        "design:figma:FIGMA_ACCESS_TOKEN",
        "design:github:GITHUB_TOKEN",
      ]);
      return configured.has(`${appId}:${provider}:${key}`)
        ? { value: "<provider-credential>" }
        : null;
    });
  });

  it("limits results to credentials supported by the current app", async () => {
    const context = { userEmail: "member@example.test", orgId: "org-1" };

    await expect(listAgentKitCapabilities("design", context)).resolves.toEqual({
      sources: { figma: { available: true } },
      integrations: [{ id: "github", label: "GitHub", kind: "provider-api" }],
    });
    await expect(listAgentKitCapabilities("slides", context)).resolves.toEqual({
      sources: { figma: { available: true } },
      integrations: [
        { id: "google_drive", label: "Google Drive", kind: "provider-api" },
        { id: "google_slides", label: "Google Slides", kind: "provider-api" },
      ],
    });
    expect(mocks.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "design",
        provider: "figma",
        key: "FIGMA_ACCESS_TOKEN",
        workspaceProvider: "figma",
        ctx: context,
      }),
    );
  });

  it("recognizes a connected workspace OAuth account using the same account binding as the Figma runtime", async () => {
    mocks.resolve.mockResolvedValue(null);
    mocks.resolveWorkspaceConnection.mockImplementation(async ({ provider }) =>
      provider === "figma"
        ? {
            available: true,
            connection: {
              accountId: "figma-account",
              ownerEmail: "member@example.test",
            },
          }
        : { available: false, connection: null },
    );
    mocks.hasOAuthTokens.mockImplementation(
      async (provider, owner, accountId) =>
        provider === "figma" &&
        owner === "member@example.test" &&
        accountId === "figma-account",
    );

    await expect(
      listAgentKitCapabilities("design", {
        userEmail: "member@example.test",
        orgId: "org-1",
      }),
    ).resolves.toMatchObject({ sources: { figma: { available: true } } });
    expect(mocks.hasOAuthTokens).toHaveBeenCalledWith(
      "figma",
      "member@example.test",
      "figma-account",
    );
  });

  it("checks Figma processor readiness without probing unrelated integrations", async () => {
    mocks.resolveWorkspaceConnection.mockImplementation(
      async ({ provider }) => {
        if (provider === "github")
          throw new Error("GitHub resolver unavailable");
        return { available: false, connection: null };
      },
    );

    await expect(
      isAgentKitFigmaSourceAvailable({
        userEmail: "member@example.test",
        orgId: "org-1",
      }),
    ).resolves.toBe(true);
    expect(mocks.resolveWorkspaceConnection).toHaveBeenCalledTimes(1);
    expect(mocks.resolveWorkspaceConnection).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "figma", appId: "design" }),
    );
  });

  it("lists only connected, request-visible MCP tools and revalidates their invocation", async () => {
    const serverId = "org_team-1_Figma";
    const manager = {
      getConfig: () => ({
        servers: {
          [serverId]: { type: "http", url: "https://mcp.example.test" },
        },
      }),
      getStatus: () => ({ connectedServers: [serverId] }),
      getToolsForServer: () => [{ name: `mcp__${serverId}__get_file` }],
      hasServer: () => true,
    };
    mocks.getMcpManagerForCurrentRequest.mockResolvedValue(manager);

    const capabilities = await listAgentKitCapabilities("design", {
      userEmail: "member@example.test",
      orgId: "team-1",
    });
    expect(capabilities.integrations).toContainEqual({
      id: `mcp:${serverId}`,
      label: "Figma",
      kind: "mcp",
    });
    await expect(
      readAgentKitIntegrationIntent("design", `mcp:${serverId}`, {
        userEmail: "member@example.test",
        orgId: "team-1",
      }),
    ).resolves.toMatchObject({
      id: `mcp:${serverId}`,
      title: "Figma",
      context: expect.stringContaining("selected Figma MCP server"),
    });

    mocks.isMcpToolAllowed.mockReturnValue(false);
    await expect(
      readAgentKitIntegrationIntent("design", `mcp:${serverId}`, {
        userEmail: "member@example.test",
        orgId: "another-org",
      }),
    ).resolves.toBeNull();
  });

  it("exposes visible first-party remote apps independently of the caller app", async () => {
    const serverId = "org_team-1_assets";
    mocks.getMcpManagerForCurrentRequest.mockResolvedValue({
      getConfig: () => ({
        servers: {
          [serverId]: {
            type: "http",
            url: "https://mcp.example.test",
            firstParty: true,
            firstPartyAppId: "assets",
          },
        },
      }),
      getStatus: () => ({ connectedServers: [serverId] }),
      getToolsForServer: () => [{ name: `mcp__${serverId}__tool` }],
      hasServer: () => true,
    });

    const capabilities = await listAgentKitCapabilities("design", {
      userEmail: "member@example.test",
      orgId: "team-1",
    });
    expect(
      capabilities.integrations.filter(
        (integration) => integration.kind === "mcp",
      ),
    ).toEqual([{ id: `mcp:${serverId}`, label: "assets", kind: "mcp" }]);
    await expect(
      readAgentKitIntegrationIntent("design", `mcp:${serverId}`, {
        userEmail: "member@example.test",
        orgId: "team-1",
      }),
    ).resolves.toMatchObject({ id: `mcp:${serverId}` });
  });

  it("does not expose Google integrations from an OAuth token without an app grant", async () => {
    mocks.resolve.mockResolvedValue(null);
    mocks.resolveWorkspaceConnection.mockResolvedValue({
      available: false,
      connection: null,
    });

    await expect(
      listAgentKitCapabilities("slides", {
        userEmail: "member@example.test",
        orgId: "org-1",
      }),
    ).resolves.toEqual({
      sources: { figma: { available: false } },
      integrations: [],
    });
  });

  it("returns only a safe invocation intent for a currently ready integration", async () => {
    const intent = await readAgentKitIntegrationIntent("design", "github", {
      userEmail: "member@example.test",
      orgId: "org-1",
    });

    expect(intent).toEqual({
      id: "github",
      title: "GitHub",
      context: expect.stringContaining("invocation intent, not retrieved data"),
    });
    expect(JSON.stringify(intent)).not.toContain("<provider-credential>");
  });

  it("revalidates only the selected integration instead of probing unrelated providers", async () => {
    mocks.resolveWorkspaceConnection.mockImplementation(
      async ({ provider }) => {
        if (provider === "figma") throw new Error("Figma resolver unavailable");
        return { available: false, connection: null };
      },
    );

    await expect(
      readAgentKitIntegrationIntent("design", "github", {
        userEmail: "member@example.test",
        orgId: "org-1",
      }),
    ).resolves.toMatchObject({ id: "github", title: "GitHub" });
    expect(mocks.resolveWorkspaceConnection).toHaveBeenCalledTimes(1);
    expect(mocks.resolveWorkspaceConnection).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "github", appId: "design" }),
    );
  });

  it("rejects unsupported or disconnected integrations without fabricating context", async () => {
    mocks.resolve.mockResolvedValue(null);
    const context = { userEmail: "member@example.test", orgId: "org-1" };

    await expect(
      readAgentKitIntegrationIntent("design", "google_drive", context),
    ).resolves.toBeNull();
    await expect(
      readAgentKitIntegrationIntent("design", "github", context),
    ).resolves.toBeNull();
  });

  it("preserves credential-store failures instead of treating them as disconnected", async () => {
    mocks.resolve.mockRejectedValue(new Error("Credential store unavailable"));

    await expect(
      listAgentKitCapabilities("design", {
        userEmail: "member@example.test",
        orgId: "org-1",
      }),
    ).rejects.toThrow("Credential store unavailable");
  });
});
