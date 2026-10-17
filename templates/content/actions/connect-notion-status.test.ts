import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentNotionOwner: vi.fn(),
  getNotionConnectionForOwner: vi.fn(),
  resolveSecret: vi.fn(),
  getRequestOrgId: vi.fn(),
  findConnectedMcpServersForProvider: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  resolveSecret: mocks.resolveSecret,
  getRequestOrgId: mocks.getRequestOrgId,
}));

vi.mock("@agent-native/core/mcp-client", () => ({
  findConnectedMcpServersForProvider: mocks.findConnectedMcpServersForProvider,
}));

vi.mock("../server/lib/notion.js", () => ({
  getNotionConnectionForOwner: mocks.getNotionConnectionForOwner,
}));

vi.mock("./_notion-action-utils.js", () => ({
  getCurrentNotionOwner: mocks.getCurrentNotionOwner,
}));

import connectNotionStatus from "./connect-notion-status";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentNotionOwner.mockReturnValue("owner@example.com");
  mocks.getNotionConnectionForOwner.mockResolvedValue(null);
  mocks.resolveSecret.mockResolvedValue(null);
  mocks.getRequestOrgId.mockReturnValue("org_1");
  mocks.findConnectedMcpServersForProvider.mockResolvedValue({
    servers: [],
    unreadableScopes: [],
  });
});

describe("connect-notion-status", () => {
  it("reports connected for the owner's stored Notion OAuth account", async () => {
    mocks.getNotionConnectionForOwner.mockResolvedValue({
      accountId: "workspace-1",
      accessToken: "secret",
      workspaceName: "Docs",
      workspaceId: "workspace-1",
    });

    await expect(connectNotionStatus.run({})).resolves.toMatchObject({
      connected: true,
      workspaceName: "Docs",
      mode: "oauth",
      error: undefined,
    });
  });

  it("does not report missing_credentials when the OAuth client resolves", async () => {
    mocks.resolveSecret.mockImplementation(async (key: string) =>
      key === "NOTION_CLIENT_ID" || key === "NOTION_CLIENT_SECRET"
        ? `deploy-${key}`
        : null,
    );

    await expect(connectNotionStatus.run({})).resolves.toMatchObject({
      connected: false,
      error: undefined,
    });
  });

  it("reports missing_credentials only when no client and no connection exist", async () => {
    await expect(connectNotionStatus.run({})).resolves.toMatchObject({
      connected: false,
      error: "missing_credentials",
    });
  });

  it("requires both halves of the OAuth client before offering to connect", async () => {
    mocks.resolveSecret.mockImplementation(async (key: string) =>
      key === "NOTION_CLIENT_ID" ? "deploy-id" : null,
    );

    await expect(connectNotionStatus.run({})).resolves.toMatchObject({
      connected: false,
      error: "missing_credentials",
    });
  });
});

describe("connect-notion-status MCP surface", () => {
  const notionMcpServer = {
    id: "mcps_1",
    name: "Notion",
    url: "https://mcp.notion.com/mcp",
    scope: "user",
  };

  it("reports the connected Notion MCP server when no OAuth account exists", async () => {
    mocks.findConnectedMcpServersForProvider.mockResolvedValue({
      servers: [notionMcpServer],
      unreadableScopes: [],
    });

    const result = await connectNotionStatus.run({});

    expect(result.mcp).toMatchObject({
      connected: true,
      servers: [notionMcpServer],
    });
    expect(result.statusSummary).toContain("Notion MCP server is connected");
    expect(result.statusSummary).toContain("separate connections");
  });

  it("keeps `connected` scoped to the OAuth account that sync actually needs", async () => {
    mocks.findConnectedMcpServersForProvider.mockResolvedValue({
      servers: [notionMcpServer],
      unreadableScopes: [],
    });

    await expect(connectNotionStatus.run({})).resolves.toMatchObject({
      connected: false,
      mode: null,
    });
  });

  it("reports both surfaces when the account and the MCP server are connected", async () => {
    mocks.getNotionConnectionForOwner.mockResolvedValue({
      accountId: "workspace-1",
      accessToken: "secret",
      workspaceName: "Docs",
      workspaceId: "workspace-1",
    });
    mocks.findConnectedMcpServersForProvider.mockResolvedValue({
      servers: [notionMcpServer],
      unreadableScopes: [],
    });

    const result = await connectNotionStatus.run({});

    expect(result.connected).toBe(true);
    expect(result.mcp?.connected).toBe(true);
    expect(result.statusSummary).toContain("Notion account is connected");
    expect(result.statusSummary).toContain("Notion MCP server is connected");
  });

  it("says MCP status is unknown rather than disconnected when a scope is unreadable", async () => {
    mocks.findConnectedMcpServersForProvider.mockResolvedValue({
      servers: [],
      unreadableScopes: ["org"],
    });

    const result = await connectNotionStatus.run({});

    expect(result.mcp).toMatchObject({
      connected: false,
      unreadableScopes: ["org"],
    });
    expect(result.statusSummary).toContain("Notion MCP status is unknown");
    expect(result.statusSummary).not.toContain("No Notion MCP server");
  });

  it("scopes the MCP lookup to the caller's user and org", async () => {
    await connectNotionStatus.run({});

    expect(mocks.findConnectedMcpServersForProvider).toHaveBeenCalledWith({
      providerId: "notion",
      userEmail: "owner@example.com",
      orgId: "org_1",
    });
  });
});
