import { beforeEach, describe, expect, it, vi } from "vitest";

const listVisibleMcpTools = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/mcp-client", () => ({
  listVisibleMcpTools,
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

function tool(name: string, serverId = "org-dbt") {
  return {
    serverId,
    name,
    description: `${name} description`,
    inputSchema: { type: "object", secret: "must not be projected" },
  };
}

describe("readDbtMcpStatus", () => {
  beforeEach(() => {
    listVisibleMcpTools.mockReset();
  });

  it("projects only the dbt metadata capability contract", async () => {
    listVisibleMcpTools.mockResolvedValue([
      ...metadataToolNames.map((name) => tool(name)),
      tool("execute_sql"),
      tool("text_to_sql"),
    ]);

    await expect(readDbtMcpStatus()).resolves.toEqual({
      available: true,
      configured: true,
      serverId: "org-dbt",
      capabilities: {
        discovery: true,
        lineage: true,
        healthAndFreshness: true,
      },
      toolCount: metadataToolNames.length,
      setupLink: "/data-sources?source=dbt&returnTo=ask",
    });
  });

  it("ignores dbt SQL and unrelated tools", async () => {
    listVisibleMcpTools.mockResolvedValue([
      tool("get_all_models", "dbt-discovery"),
      tool("execute_sql", "dbt-discovery"),
      tool("unrelated_tool", "dbt-discovery"),
    ]);

    await expect(readDbtMcpStatus()).resolves.toEqual({
      available: true,
      configured: true,
      serverId: "dbt-discovery",
      capabilities: {
        discovery: true,
        lineage: false,
        healthAndFreshness: false,
      },
      toolCount: 1,
      setupLink: "/data-sources?source=dbt&returnTo=ask",
    });
  });

  it("reports SQL-only dbt tools as disconnected", async () => {
    listVisibleMcpTools.mockResolvedValue([
      tool("execute_sql"),
      tool("text_to_sql"),
    ]);

    await expect(readDbtMcpStatus()).resolves.toMatchObject({
      available: true,
      configured: false,
      toolCount: 0,
    });
  });

  it("reports manager or list failure as unreadable rather than disconnected", async () => {
    listVisibleMcpTools.mockRejectedValue(
      new Error("MCP client is not configured."),
    );

    await expect(readDbtMcpStatus()).resolves.toMatchObject({
      available: false,
      configured: null,
      error: "MCP client is not configured.",
      toolCount: 0,
    });
  });
});
