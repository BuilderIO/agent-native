import { mountMCP } from "@agent-native/core/mcp";
import {
  loadActionsFromStaticRegistry,
  type ActionEntry,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { createAutomationToolEntries } from "@agent-native/core/triggers";

import actionsRegistry from "../../.generated/actions-registry.js";
import { PLAN_CONNECTOR_CATALOG } from "../lib/plan-connector-catalog.js";

const TOOL_SEARCH_ACTION_NAME = "tool-search";

function attachPlanToolSearch(
  registry: Record<string, ActionEntry>,
): Record<string, ActionEntry> {
  const searchableNames = new Set(PLAN_CONNECTOR_CATALOG);
  registry[TOOL_SEARCH_ACTION_NAME] = {
    tool: {
      description:
        "Discover callable Plan MCP tools by name and description. Omit query to list the visible Plan connector surface; pass query to filter by capability.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Optional search text, e.g. create plan, share resource, or comments.",
          },
          limit: {
            type: "number",
            description: "Maximum results to return. Defaults to 8.",
          },
        },
      },
    },
    http: false,
    readOnly: true,
    run: async (args: { query?: unknown; limit?: unknown } = {}) => {
      const query = String(args.query ?? "")
        .trim()
        .toLowerCase();
      const rawLimit = Number(args.limit);
      const limit =
        Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.min(Math.floor(rawLimit), 25)
          : 8;
      const results = Object.entries(registry)
        .filter(([name, entry]) => {
          if (name === TOOL_SEARCH_ACTION_NAME) return false;
          if (!searchableNames.has(name)) return false;
          const description = entry.tool.description ?? "";
          if (!query) return true;
          return `${name} ${description}`.toLowerCase().includes(query);
        })
        .slice(0, query ? limit : 100)
        .map(([name, entry]) => ({
          name,
          description: entry.tool.description ?? name,
          readOnly: entry.readOnly === true,
        }));

      return {
        query,
        totalTools: Object.keys(registry).filter((name) =>
          searchableNames.has(name),
        ).length,
        count: results.length,
        results,
      };
    },
  };
  return registry;
}

function requireMcpOwner(operation: string): string {
  const owner = getRequestUserEmail();
  if (!owner) {
    throw new Error(
      `Cannot ${operation}: MCP request is missing an authenticated owner.`,
    );
  }
  return owner;
}

export default function planMcpPlugin(nitroApp: any) {
  const actions = attachPlanToolSearch({
    ...loadActionsFromStaticRegistry(actionsRegistry),
    ...createAutomationToolEntries(() => requireMcpOwner("manage automations")),
  });

  mountMCP(nitroApp, {
    name: "Plan",
    title: "Agent-Native Plan",
    appId: "plan",
    description:
      "Create, review, update, publish, and export Agent-Native visual plans.",
    websiteUrl: "https://plan.agent-native.com",
    actions,
    productionActions: actions,
    connectorCatalog: PLAN_CONNECTOR_CATALOG,
  });
}
