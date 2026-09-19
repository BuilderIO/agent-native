import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findConnectedMcpServersForProvider: vi.fn(),
  getRequestOrgId: vi.fn(),
  listVisibleMcpTools: vi.fn(),
}));

vi.mock("@agent-native/core/mcp-client", () => ({
  findConnectedMcpServersForProvider: mocks.findConnectedMcpServersForProvider,
  listVisibleMcpTools: mocks.listVisibleMcpTools,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
}));

const { readDbtMcpStatus } = await import("./dbt-mcp-status");

const metadataToolNames = [
  "get_all_models",
  "get_all_sources",
  "get_node_details",
  "get_related_models",
  "get_mart_models",
  "get_lineage",
  "get_model_health",
  "get_model_performance",
];

const dbtServer = {
  id: "mcps-dbt",
  mergedId: "org_org-1_dbt",
  name: "dbt",
  url: "https://acct.us1.dbt.com/api/ai/v1/mcp/",
  scope: "org",
};

function tool(name: string, serverId = dbtServer.mergedId) {
  return {
    serverId,
    name,
    description: `${name} description`,
    inputSchema: { type: "object", secret: "must not be projected" },
  };
}

describe("readDbtMcpStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.findConnectedMcpServersForProvider.mockResolvedValue({
      servers: [dbtServer],
      unreadableScopes: [],
    });
    mocks.listVisibleMcpTools.mockResolvedValue([]);
  });

  it("projects metadata capabilities from a verified organization dbt server", async () => {
    mocks.listVisibleMcpTools.mockResolvedValue([
      ...metadataToolNames.map((name) => tool(name)),
      tool("execute_sql"),
      tool("text_to_sql"),
    ]);

    await expect(readDbtMcpStatus()).resolves.toEqual({
      available: true,
      configured: true,
      serverId: "mcps-dbt",
      capabilities: {
        discovery: true,
        lineage: true,
        healthAndFreshness: true,
      },
      toolCount: metadataToolNames.length,
      setupLink: "/data-sources?source=dbt&returnTo=ask",
    });
    expect(mocks.findConnectedMcpServersForProvider).toHaveBeenCalledWith({
      providerId: "dbt",
      orgId: "org-1",
    });
    expect(mocks.listVisibleMcpTools).toHaveBeenCalledWith({
      serverId: "org_org-1_dbt",
    });
  });

  it("ignores SQL and unrelated tools after verifying the dbt server", async () => {
    mocks.listVisibleMcpTools.mockResolvedValue([
      tool("get_all_models"),
      tool("execute_sql"),
      tool("unrelated_tool"),
    ]);

    await expect(readDbtMcpStatus()).resolves.toMatchObject({
      configured: true,
      capabilities: {
        discovery: true,
        lineage: false,
        healthAndFreshness: false,
      },
      toolCount: 1,
    });
  });

  it("does not treat unrelated servers with dbt-like tool names as dbt", async () => {
    mocks.findConnectedMcpServersForProvider.mockResolvedValue({
      servers: [],
      unreadableScopes: [],
    });
    mocks.listVisibleMcpTools.mockResolvedValue([
      tool("get_lineage", "unrelated"),
    ]);

    await expect(readDbtMcpStatus()).resolves.toMatchObject({
      available: true,
      configured: false,
      toolCount: 0,
    });
    expect(mocks.listVisibleMcpTools).not.toHaveBeenCalled();
  });

  it("keeps a verified dbt connection configured when it exposes no metadata tools", async () => {
    mocks.listVisibleMcpTools.mockResolvedValue([
      tool("execute_sql"),
      tool("text_to_sql"),
    ]);

    await expect(readDbtMcpStatus()).resolves.toMatchObject({
      available: true,
      configured: true,
      serverId: "mcps-dbt",
      capabilities: {
        discovery: false,
        lineage: false,
        healthAndFreshness: false,
      },
      toolCount: 0,
    });
  });

  it("reports organization connection lookup failures as unreadable", async () => {
    mocks.findConnectedMcpServersForProvider.mockResolvedValue({
      servers: [],
      unreadableScopes: ["org"],
    });

    await expect(readDbtMcpStatus()).resolves.toMatchObject({
      available: false,
      configured: null,
      error: "The organization MCP server list could not be read.",
      toolCount: 0,
    });
  });

  it("reports tool-list failures as unreadable rather than disconnected", async () => {
    mocks.listVisibleMcpTools.mockRejectedValue(
      new Error("MCP client is not configured."),
    );

    await expect(readDbtMcpStatus()).resolves.toMatchObject({
      available: false,
      configured: null,
      error: "MCP client is not configured.",
      toolCount: 0,
    });
  });

  it("does not inspect personal connections without an organization", async () => {
    mocks.getRequestOrgId.mockReturnValue(null);

    await expect(readDbtMcpStatus()).resolves.toMatchObject({
      available: true,
      configured: false,
      toolCount: 0,
    });
    expect(mocks.findConnectedMcpServersForProvider).not.toHaveBeenCalled();
    expect(mocks.listVisibleMcpTools).not.toHaveBeenCalled();
  });
});
