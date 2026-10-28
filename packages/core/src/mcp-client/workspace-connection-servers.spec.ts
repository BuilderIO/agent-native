import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import { getRequestUserEmail } from "../server/request-context.js";
import type { McpServerConfig } from "./config.js";
import { mergedConfigKey } from "./remote-store.js";

const resolveWorkspaceConnectionForApp = vi.hoisted(() => vi.fn());
const resolveOAuthAccessToken = vi.hoisted(() => vi.fn());
const createProviderApiRuntime = vi.hoisted(() => vi.fn());

vi.mock("../workspace-connections/store.js", () => ({
  resolveWorkspaceConnectionForApp,
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

beforeEach(() => {
  defineAppConfig({ app: { id: "crm", workspaceId: "crm" } });
  resolveWorkspaceConnectionForApp.mockReset();
  resolveOAuthAccessToken.mockReset();
  createProviderApiRuntime
    .mockReset()
    .mockReturnValue({ resolveOAuthAccessToken });
});

afterEach(() => {
  resetAppConfigForTests();
});

describe("addWorkspaceConnectionMcpServers", () => {
  it("adds HubSpot MCP for the caller's own connection, with no stored token", async () => {
    resolveWorkspaceConnectionForApp.mockResolvedValue({
      available: true,
      connection: { id: "hubspot-alice" },
    });
    const servers: Record<string, McpServerConfig> = {};

    await addWorkspaceConnectionMcpServers(servers, alice);

    expect(resolveWorkspaceConnectionForApp).toHaveBeenCalledWith({
      appId: "crm",
      provider: "hubspot",
      connectionOwnerEmail: "alice@example.com",
      requireConnected: true,
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

  it("adds nothing without a connection the caller owns", async () => {
    resolveWorkspaceConnectionForApp.mockResolvedValue({
      available: false,
      connection: null,
      reason: "No HubSpot connection.",
    });
    const servers: Record<string, McpServerConfig> = {};

    await addWorkspaceConnectionMcpServers(servers, alice);

    expect(servers).toEqual({});
  });

  it("keeps a HubSpot MCP server the user already added instead of duplicating it", async () => {
    const servers: Record<string, McpServerConfig> = {
      user_abc_hubspot: { type: "http", url: "https://mcp.hubspot.com/" },
    };

    await addWorkspaceConnectionMcpServers(servers, alice);

    expect(resolveWorkspaceConnectionForApp).not.toHaveBeenCalled();
    expect(Object.keys(servers)).toEqual(["user_abc_hubspot"]);
  });

  it("leaves HubSpot out, without failing, when the connection can't be read", async () => {
    resolveWorkspaceConnectionForApp.mockRejectedValue(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const servers: Record<string, McpServerConfig> = {};

    await expect(
      addWorkspaceConnectionMcpServers(servers, alice),
    ).resolves.toBeUndefined();

    expect(servers).toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
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
