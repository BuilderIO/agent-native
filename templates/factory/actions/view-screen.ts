/**
 * See what the user is currently looking at on screen.
 *
 * Reads and returns the current navigation state from application state.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { dispatchActions } from "@agent-native/dispatch/actions";
import { z } from "zod";

import {
  defaultFactoryDefinition,
  listFactoryDefinitions,
  listFactoryInboxPreview,
  parseFactoryGraph,
  readFactoryDefinition,
} from "../server/factory-graph/store.js";
import { listFactoryAutomationPreview } from "../server/lib/factory-automation-preview.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

async function runDispatchAction(name: string, args: Record<string, unknown>) {
  const action = dispatchActions[name];
  if (!action) throw new Error(`Dispatch action not found: ${name}`);
  return action.run(args);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the factory list, Inbox, Automations jobs, Map selection, or other visible tab — not a graph unless the user is on the Map. Always call this first when the visible selection matters.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async (_, context) => {
    const navigation = await readAppState("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    if (
      navigation &&
      typeof navigation === "object" &&
      "view" in navigation &&
      navigation.view === "factory"
    ) {
      const { userEmail, orgId } = await requireWorkspaceMember(
        workspaceMemberIdentityFromContext(context),
      );
      const state = navigation as Record<string, unknown>;
      if (state.creatingFactory === true) {
        screen.factory = { creating: true };
      } else {
        const factoryId = stringField(state.factoryId);
        const tab =
          stringField(state.factoryTab) ?? (factoryId ? "inbox" : "list");

        if (!factoryId) {
          const rows = await listFactoryDefinitions(orgId);
          const fallback = defaultFactoryDefinition();
          screen.surface = "factory-list";
          screen.factories = [
            ...(rows.some((row) => row.id === fallback.id)
              ? []
              : [{ id: fallback.id, name: fallback.name }]),
            ...rows.map((row) => ({ id: row.id, name: row.name })),
          ];
        } else {
          const row = await readFactoryDefinition(orgId, factoryId);
          const fallback = defaultFactoryDefinition();
          const name =
            row?.name ??
            (factoryId === fallback.id ? fallback.name : factoryId);
          const factory: Record<string, unknown> = {
            id: factoryId,
            name,
            tab,
          };

          if (tab === "map") {
            const graph = row
              ? parseFactoryGraph(row.graphJson)
              : fallback.graph;
            const selectedNodeId = stringField(state.factoryNodeId);
            const selectedEdgeId = stringField(state.factoryEdgeId);
            factory.graphVersion = row?.graphVersion ?? graph.version;
            factory.selectedNode = selectedNodeId
              ? graph.nodes.find((node) => node.id === selectedNodeId)
              : undefined;
            factory.selectedEdge = selectedEdgeId
              ? graph.edges.find((edge) => edge.id === selectedEdgeId)
              : undefined;
          } else if (tab === "inbox") {
            const inbox = await listFactoryInboxPreview(orgId, factoryId);
            factory.inbox = inbox;
            const selectedItemId = stringField(state.factoryItemId);
            if (selectedItemId) factory.selectedItemId = selectedItemId;
          } else if (tab === "automations") {
            factory.automations = await listFactoryAutomationPreview(
              userEmail,
              orgId,
              factoryId,
            );
            if (state.factoryCreatingAutomation === true) {
              factory.creatingAutomation = true;
            }
            const selectedAutomationId = stringField(state.factoryAutomationId);
            if (selectedAutomationId) {
              factory.selectedAutomationId = selectedAutomationId;
            }
          }

          screen.factory = factory;
        }
      }

      if (state.factoryTab === "agents") {
        const [apps, agents] = await Promise.all([
          runDispatchAction("list-workspace-apps", {
            includeAgentCards: false,
          }),
          runDispatchAction("list-workspace-resources", { kind: "agent" }),
        ]);
        screen.factoryAgents = { apps, agents };
      }
    }

    if (
      navigation &&
      typeof navigation === "object" &&
      "view" in navigation &&
      navigation.view === "agents"
    ) {
      const [apps, agents] = await Promise.all([
        runDispatchAction("list-workspace-apps", {
          includeAgentCards: false,
        }),
        runDispatchAction("list-workspace-resources", { kind: "agent" }),
      ]);
      screen.agents = { apps, agents };
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
});
