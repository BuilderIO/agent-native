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
import { z } from "zod";

import {
  defaultFactoryDefinition,
  DEFAULT_FACTORY_ID,
  parseFactoryGraph,
  readFactoryDefinition,
} from "../server/factory-graph/store.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current navigation state for chat or Factory. Always call this first when the visible selection matters.",
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
      const { orgId } = await requireWorkspaceMember(
        workspaceMemberIdentityFromContext(context),
      );
      const state = navigation as Record<string, unknown>;
      const factoryId =
        typeof state.factoryId === "string" && state.factoryId.trim()
          ? state.factoryId
          : DEFAULT_FACTORY_ID;
      const row = await readFactoryDefinition(orgId, factoryId);
      const fallback = defaultFactoryDefinition();
      const graph = row ? parseFactoryGraph(row.graphJson) : fallback.graph;
      const selectedNodeId =
        typeof state.factoryNodeId === "string" ? state.factoryNodeId : null;
      const selectedEdgeId =
        typeof state.factoryEdgeId === "string" ? state.factoryEdgeId : null;

      screen.factory = {
        id: factoryId,
        name: row?.name ?? fallback.name,
        graphVersion: row?.graphVersion ?? graph.version,
        selectedNode: graph.nodes.find((node) => node.id === selectedNodeId),
        selectedEdge: graph.edges.find((edge) => edge.id === selectedEdgeId),
      };
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
});
