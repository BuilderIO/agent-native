import { beforeEach, describe, expect, it, vi } from "vitest";

const listVisibleMcpTools = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/mcp-client", () => ({
  listVisibleMcpTools,
}));

const { readDbtMcpStatus } = await import("./dbt-mcp-status");

const fullContractNames = [
  "get_all_models",
  "get_all_sources",
  "get_node_details",
  "get_related_models",
  "get_mart_models",
  "get_lineage",
  "get_model_health",
  "get_model_performance",
  "list_metrics",
  "get_dimensions",
  "get_entities",
  "get_dimension_values",
  "query_metrics",
  "get_metrics_compiled_sql",
  "list_saved_queries",
  "execute_sql",
  "text_to_sql",
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

  it("projects the full official dbt capability contract", async () => {
    listVisibleMcpTools.mockResolvedValue(
      fullContractNames.map((name) => tool(name)),
    );

    await expect(readDbtMcpStatus()).resolves.toEqual({
      available: true,
      configured: true,
      serverId: "org-dbt",
      capabilities: {
        discovery: true,
        lineage: true,
        healthAndFreshness: true,
        semanticLayer: true,
      },
      sqlTools: {
        available: true,
        intentionallyUnused: true,
      },
      toolCount: fullContractNames.length,
      setupLink: "/data-sources?source=dbt&returnTo=ask",
    });
  });

  it("reports discovery-only dbt without treating SQL tools as a capability", async () => {
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
        semanticLayer: false,
      },
      sqlTools: {
        available: true,
        intentionallyUnused: true,
      },
      toolCount: 2,
      setupLink: "/data-sources?source=dbt&returnTo=ask",
    });
  });

  it("reports a successful empty list as disconnected", async () => {
    listVisibleMcpTools.mockResolvedValue([]);

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
