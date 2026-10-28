import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import { getRequestUserEmail } from "../server/request-context.js";
import type { McpServerConfig } from "./config.js";
import { mergedConfigKey } from "./remote-store.js";

const resolveWorkspaceConnectionsForApp = vi.hoisted(() => vi.fn());
const resolveOAuthAccessToken = vi.hoisted(() => vi.fn());
const createProviderApiRuntime = vi.hoisted(() => vi.fn());

vi.mock("../workspace-connections/store.js", () => ({
  resolveWorkspaceConnectionsForApp,
}));
vi.mock("../provider-api/index.js", () => ({ createProviderApiRuntime }));

const {
  addWorkspaceConnectionMcpServers,
  resolveWorkspaceConnectionMcpBearer,
} = await import("./workspace-connection-servers.js");

const alice = { userEmail: "alice@example.com", orgId: "org-1" };
const hubspotKey = mergedConfigKey(
  "user",
  { id: "x", name: "hubspot", url: "https://mcp.hubspot.com", createdAt: 0 },
  alice.userEmail,
);

function hubspotConnection(
  id: string,
  overrides: {
    ownerEmail?: string;
    scope?: string;
    status?: string;
  } = {},
) {
  return {
    id,
    provider: "hubspot",
    status: overrides.status ?? "connected",
    ownerEmail: overrides.ownerEmail ?? "alice@example.com",
    config: { workspaceConnectionScope: overrides.scope ?? "user" },
  };
}

beforeEach(() => {
  defineAppConfig({ app: { id: "crm", workspaceId: "crm" } });
  resolveWorkspaceConnectionsForApp.mockReset();
  resolveOAuthAccessToken.mockReset();
  createProviderApiRuntime
    .mockReset()
    .mockReturnValue({ resolveOAuthAccessToken });
});

afterEach(() => {
  resetAppConfigForTests();
});

describe("addWorkspaceConnectionMcpServers", () => {
  it("adds HubSpot MCP for the caller's own personal connection, with no stored token", async () => {
    resolveWorkspaceConnectionsForApp.mockResolvedValue([
      hubspotConnection("hubspot-alice"),
    ]);
    const servers: Record<string, McpServerConfig> = {};

    await addWorkspaceConnectionMcpServers(servers, alice);

    expect(resolveWorkspaceConnectionsForApp).toHaveBeenCalledWith({
      appId: "crm",
      provider: "hubspot",
    });
    expect(servers[hubspotKey]).toMatchObject({
      type: "http",
      url: "https://mcp.hubspot.com",
      workspaceConnection: {
        provider: "hubspot",
        connectionId: "hubspot-alice",
        ownerEmail: "alice@example.com",
        orgId: "org-1",
        appId: "crm",
      },
    });
    expect(servers[hubspotKey]).not.toHaveProperty("headers");
  });

  it("never uses an organization or app connection, even one the caller created", async () => {
    resolveWorkspaceConnectionsForApp.mockResolvedValue([
      hubspotConnection("hubspot-org", { scope: "organization" }),
      hubspotConnection("hubspot-app", { scope: "app" }),
      hubspotConnection("hubspot-bob", { ownerEmail: "bob@example.com" }),
      hubspotConnection("hubspot-stale", { status: "needs_reauth" }),
    ]);
    const servers: Record<string, McpServerConfig> = {};

    await addWorkspaceConnectionMcpServers(servers, alice);

    expect(servers).toEqual({});
  });

  it("picks the personal connection when the caller also created a shared one", async () => {
    resolveWorkspaceConnectionsForApp.mockResolvedValue([
      hubspotConnection("hubspot-org", { scope: "organization" }),
      hubspotConnection("hubspot-alice"),
    ]);
    const servers: Record<string, McpServerConfig> = {};

    await addWorkspaceConnectionMcpServers(servers, alice);

    expect(servers[hubspotKey]).toMatchObject({
      workspaceConnection: { connectionId: "hubspot-alice" },
    });
  });

  it("reports two personal connections as ambiguous instead of picking one", async () => {
    resolveWorkspaceConnectionsForApp.mockResolvedValue([
      hubspotConnection("hubspot-sandbox"),
      hubspotConnection("hubspot-org", { scope: "organization" }),
      hubspotConnection("hubspot-production"),
    ]);
    const servers: Record<string, McpServerConfig> = {};

    await addWorkspaceConnectionMcpServers(servers, alice);

    const server = servers[hubspotKey];
    expect(server).toMatchObject({
      type: "http",
      url: "https://mcp.hubspot.com",
    });
    expect(server).not.toHaveProperty("workspaceConnection");
    expect(
      server?.type === "http" ? server.configurationError?.message : undefined,
    ).toBe(
      "You have 2 personal hubspot connections for this app, so the hubspot MCP server can't tell which account to use. Disconnect the extra ones, or add the hubspot MCP server yourself.",
    );
  });

  it("keeps a server already configured for the same endpoint", async () => {
    const servers: Record<string, McpServerConfig> = {
      user_abc_hubspot: { type: "http", url: "https://mcp.hubspot.com/" },
    };

    await addWorkspaceConnectionMcpServers(servers, alice);

    expect(resolveWorkspaceConnectionsForApp).not.toHaveBeenCalled();
    expect(Object.keys(servers)).toEqual(["user_abc_hubspot"]);
  });

  it("still adds HubSpot MCP beside a different hubspot.com server", async () => {
    resolveWorkspaceConnectionsForApp.mockResolvedValue([
      hubspotConnection("hubspot-alice"),
    ]);
    const servers: Record<string, McpServerConfig> = {
      user_abc_other: { type: "http", url: "https://dev.hubspot.com/mcp" },
    };

    await addWorkspaceConnectionMcpServers(servers, alice);

    expect(servers[hubspotKey]).toMatchObject({
      workspaceConnection: { connectionId: "hubspot-alice" },
    });
  });

  it("reports an unreadable connection on the server instead of dropping it", async () => {
    resolveWorkspaceConnectionsForApp.mockRejectedValue(new Error("db down"));
    const servers: Record<string, McpServerConfig> = {};

    await expect(
      addWorkspaceConnectionMcpServers(servers, alice),
    ).resolves.toBeUndefined();

    const server = servers[hubspotKey];
    expect(server).toMatchObject({
      type: "http",
      url: "https://mcp.hubspot.com",
    });
    expect(server).not.toHaveProperty("workspaceConnection");
    expect(
      server?.type === "http" ? server.configurationError?.message : undefined,
    ).toMatch(/could not be read/);
  });
});

describe("resolveWorkspaceConnectionMcpBearer", () => {
  it("resolves the owner's connection token as the owner", async () => {
    let requestUser: string | undefined;
    resolveOAuthAccessToken.mockImplementation(async () => {
      requestUser = getRequestUserEmail();
      return { accessToken: "hubspot-token" };
    });

    await expect(
      resolveWorkspaceConnectionMcpBearer({
        provider: "hubspot",
        connectionId: "hubspot-alice",
        ownerEmail: "alice@example.com",
        orgId: "org-1",
        appId: "crm",
      }),
    ).resolves.toBe("hubspot-token");

    expect(createProviderApiRuntime).toHaveBeenCalledWith({ appId: "crm" });
    expect(resolveOAuthAccessToken).toHaveBeenCalledWith({
      provider: "hubspot",
      connectionId: "hubspot-alice",
    });
    expect(requestUser).toBe("alice@example.com");
  });
});
