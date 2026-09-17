import {
  listVisibleMcpTools,
  type AppMcpTool,
} from "@agent-native/core/mcp-client";

const DBT_DISCOVERY_TOOLS = new Set([
  "get_all_models",
  "get_all_sources",
  "get_node_details",
  "get_related_models",
  "get_mart_models",
]);
const DBT_LINEAGE_TOOLS = new Set(["get_lineage"]);
const DBT_HEALTH_TOOLS = new Set([
  "get_model_health",
  "get_model_performance",
  "get_all_sources",
]);
const DBT_METADATA_TOOLS = new Set([
  ...DBT_DISCOVERY_TOOLS,
  ...DBT_LINEAGE_TOOLS,
  ...DBT_HEALTH_TOOLS,
]);

export interface DbtMcpStatus {
  available: boolean;
  error?: string;
  configured: boolean | null;
  serverId?: string;
  capabilities: {
    discovery: boolean;
    lineage: boolean;
    healthAndFreshness: boolean;
  };
  toolCount: number;
  setupLink: "/data-sources?source=dbt&returnTo=ask";
}

function emptyStatus(configured: false | null, error?: string): DbtMcpStatus {
  return {
    available: !error,
    ...(error ? { error } : {}),
    configured,
    capabilities: {
      discovery: false,
      lineage: false,
      healthAndFreshness: false,
    },
    toolCount: 0,
    setupLink: "/data-sources?source=dbt&returnTo=ask",
  };
}

function selectDbtServer(tools: AppMcpTool[]): AppMcpTool[] {
  const byServer = new Map<string, AppMcpTool[]>();
  for (const tool of tools) {
    if (!DBT_METADATA_TOOLS.has(tool.name)) continue;
    const current = byServer.get(tool.serverId) ?? [];
    current.push(tool);
    byServer.set(tool.serverId, current);
  }

  return (
    [...byServer.values()]
      .filter((serverTools) =>
        serverTools.some((tool) => DBT_METADATA_TOOLS.has(tool.name)),
      )
      .sort((left, right) => {
        const capabilityDifference =
          right.filter((tool) => DBT_METADATA_TOOLS.has(tool.name)).length -
          left.filter((tool) => DBT_METADATA_TOOLS.has(tool.name)).length;
        return (
          capabilityDifference ||
          left[0].serverId.localeCompare(right[0].serverId)
        );
      })[0] ?? []
  );
}

export async function readDbtMcpStatus(): Promise<DbtMcpStatus> {
  let tools: AppMcpTool[];
  try {
    tools = await listVisibleMcpTools();
  } catch (error) {
    return emptyStatus(
      null,
      error instanceof Error ? error.message : String(error),
    );
  }

  const dbtTools = selectDbtServer(tools);
  if (dbtTools.length === 0) return emptyStatus(false);

  return {
    available: true,
    configured: true,
    serverId: dbtTools[0].serverId,
    capabilities: {
      discovery: dbtTools.some((tool) => DBT_DISCOVERY_TOOLS.has(tool.name)),
      lineage: dbtTools.some((tool) => DBT_LINEAGE_TOOLS.has(tool.name)),
      healthAndFreshness: dbtTools.some((tool) =>
        DBT_HEALTH_TOOLS.has(tool.name),
      ),
    },
    toolCount: dbtTools.length,
    setupLink: "/data-sources?source=dbt&returnTo=ask",
  };
}
