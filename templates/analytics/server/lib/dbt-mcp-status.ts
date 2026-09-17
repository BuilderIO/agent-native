import {
  findConnectedMcpServersForProvider,
  listVisibleMcpTools,
  type AppMcpTool,
} from "@agent-native/core/mcp-client";
import { getRequestOrgId } from "@agent-native/core/server";

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

interface DbtServerTools {
  id: string;
  tools: AppMcpTool[];
}

function selectDbtServer(servers: DbtServerTools[]): DbtServerTools {
  return [...servers].sort(
    (left, right) =>
      right.tools.length - left.tools.length || left.id.localeCompare(right.id),
  )[0];
}

export async function readDbtMcpStatus(): Promise<DbtMcpStatus> {
  const orgId = getRequestOrgId() ?? null;
  if (!orgId) return emptyStatus(false);

  let connections;
  try {
    connections = await findConnectedMcpServersForProvider({
      providerId: "dbt",
      orgId,
    });
  } catch (error) {
    return emptyStatus(
      null,
      error instanceof Error ? error.message : String(error),
    );
  }

  if (connections.unreadableScopes.includes("org")) {
    return emptyStatus(
      null,
      "The organization MCP server list could not be read.",
    );
  }
  if (connections.servers.length === 0) return emptyStatus(false);

  let servers: DbtServerTools[];
  try {
    servers = await Promise.all(
      connections.servers.map(async (server) => ({
        id: server.id,
        tools: (
          await listVisibleMcpTools({ serverId: server.mergedId })
        ).filter((tool) => DBT_METADATA_TOOLS.has(tool.name)),
      })),
    );
  } catch (error) {
    return emptyStatus(
      null,
      error instanceof Error ? error.message : String(error),
    );
  }

  const selected = selectDbtServer(servers);
  return {
    available: true,
    configured: true,
    serverId: selected.id,
    capabilities: {
      discovery: selected.tools.some((tool) =>
        DBT_DISCOVERY_TOOLS.has(tool.name),
      ),
      lineage: selected.tools.some((tool) => DBT_LINEAGE_TOOLS.has(tool.name)),
      healthAndFreshness: selected.tools.some((tool) =>
        DBT_HEALTH_TOOLS.has(tool.name),
      ),
    },
    toolCount: selected.tools.length,
    setupLink: "/data-sources?source=dbt&returnTo=ask",
  };
}
