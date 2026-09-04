import { mountMCP } from "@agent-native/core/mcp";
import {
  attachToolSearch,
  filterFrameworkToolGroups,
  loadActionsFromStaticRegistry,
  resolveFrameworkTools,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { createAutomationToolEntries } from "@agent-native/core/triggers";

import actionsRegistry from "../../.generated/actions-registry.js";
import { PLAN_CONNECTOR_CATALOG } from "../lib/plan-connector-catalog.js";
import { PLAN_FRAMEWORK_TOOLS } from "../lib/plan-framework-tools.js";

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
  // This mount deliberately bypasses the agent-chat plugin so the external
  // connector does not wait on chat initialization — which means it has to
  // apply the framework tool policy itself. Reading the same
  // `PLAN_FRAMEWORK_TOOLS` the chat plugin does is what keeps the two mounts
  // from disagreeing about which tools exist.
  const frameworkTools = resolveFrameworkTools({
    frameworkTools: PLAN_FRAMEWORK_TOOLS,
  });

  const actions = attachToolSearch(
    filterFrameworkToolGroups(
      {
        ...loadActionsFromStaticRegistry(actionsRegistry),
        ...(frameworkTools.isEnabled("automation")
          ? createAutomationToolEntries(
              () => requireMcpOwner("manage automations"),
              "plan",
            )
          : {}),
      },
      frameworkTools.disabledGroups,
    ),
  );

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
