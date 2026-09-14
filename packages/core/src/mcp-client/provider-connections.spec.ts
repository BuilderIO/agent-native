import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listRemoteServers: vi.fn(),
}));

vi.mock("./remote-store.js", () => ({
  listRemoteServers: mocks.listRemoteServers,
}));

import { findConnectedMcpServersForProvider } from "./provider-connections.js";

const notionServer = {
  id: "mcps_1",
  name: "Notion",
  url: "https://mcp.notion.com/mcp",
  createdAt: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listRemoteServers.mockResolvedValue([]);
});

describe("findConnectedMcpServersForProvider", () => {
  it("finds the Notion MCP server Settings shows as connected", async () => {
    mocks.listRemoteServers.mockImplementation(async (scope: string) =>
      scope === "user" ? [notionServer] : [],
    );

    const result = await findConnectedMcpServersForProvider({
      providerId: "notion",
      userEmail: "alice@example.com",
      orgId: "org_1",
    });

    expect(result.servers).toEqual([
      {
        id: "mcps_1",
        name: "Notion",
        url: "https://mcp.notion.com/mcp",
        scope: "user",
      },
    ]);
    expect(result.unreadableScopes).toEqual([]);
  });

  it("finds an org-scoped server when the user has none", async () => {
    mocks.listRemoteServers.mockImplementation(async (scope: string) =>
      scope === "org" ? [notionServer] : [],
    );

    const result = await findConnectedMcpServersForProvider({
      providerId: "notion",
      userEmail: "alice@example.com",
      orgId: "org_1",
    });

    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]?.scope).toBe("org");
  });

  it("ignores servers belonging to a different provider", async () => {
    mocks.listRemoteServers.mockResolvedValue([
      { id: "mcps_2", name: "Linear", url: "https://mcp.linear.app/sse" },
    ]);

    const result = await findConnectedMcpServersForProvider({
      providerId: "notion",
      userEmail: "alice@example.com",
    });

    expect(result.servers).toEqual([]);
  });

  it("reports an unreadable scope instead of folding it into 'none saved'", async () => {
    mocks.listRemoteServers.mockImplementation(async (scope: string) => {
      if (scope === "org") throw new Error("settings unavailable");
      return [];
    });

    const result = await findConnectedMcpServersForProvider({
      providerId: "notion",
      userEmail: "alice@example.com",
      orgId: "org_1",
    });

    expect(result.servers).toEqual([]);
    expect(result.unreadableScopes).toEqual(["org"]);
  });

  it("skips a corrupt server URL without claiming it matched", async () => {
    mocks.listRemoteServers.mockResolvedValue([
      { id: "mcps_3", name: "Broken", url: "not a url" },
    ]);

    const result = await findConnectedMcpServersForProvider({
      providerId: "notion",
      userEmail: "alice@example.com",
    });

    expect(result.servers).toEqual([]);
  });

  it("matches an endpoint that sits outside the provider's link hosts", async () => {
    mocks.listRemoteServers.mockResolvedValue([
      {
        id: "mcps_4",
        name: "GitHub",
        url: "https://api.githubcopilot.com/mcp/",
      },
    ]);

    const result = await findConnectedMcpServersForProvider({
      providerId: "github",
      userEmail: "alice@example.com",
    });

    expect(result.servers).toHaveLength(1);
  });

  it("fails loudly for a provider it has no match rules for", async () => {
    await expect(
      findConnectedMcpServersForProvider({
        providerId: "not-a-real-provider",
        userEmail: "alice@example.com",
      }),
    ).rejects.toThrow(/No MCP provider match rules/);
    expect(mocks.listRemoteServers).not.toHaveBeenCalled();
  });

  it("does not read any scope when there is no user or org", async () => {
    const result = await findConnectedMcpServersForProvider({
      providerId: "notion",
    });

    expect(mocks.listRemoteServers).not.toHaveBeenCalled();
    expect(result.servers).toEqual([]);
  });
});
