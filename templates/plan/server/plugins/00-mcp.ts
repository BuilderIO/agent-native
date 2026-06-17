import { loadActionsFromStaticRegistry } from "@agent-native/core/server";
import { mountMCP } from "@agent-native/core/mcp";
import actionsRegistry from "../../.generated/actions-registry.js";
import { PLAN_CONNECTOR_CATALOG } from "../lib/plan-connector-catalog.js";

export default function planMcpPlugin(nitroApp: any) {
  const actions = loadActionsFromStaticRegistry(actionsRegistry);

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
