import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  defaultFactoryDefinition,
  DEFAULT_FACTORY_ID,
  parseFactoryGraph,
  readFactoryDefinition,
  readFactoryMetrics,
} from "../server/factory-graph/store.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "Read the selected Factory's deterministic graph, version, comments target, and live evidence metrics.",
  schema: z.object({
    factoryId: z.string().trim().min(1).max(120).default(DEFAULT_FACTORY_ID),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ factoryId }, context) => {
    const { orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const row = await readFactoryDefinition(orgId, factoryId);
    const fallback = defaultFactoryDefinition();
    const graph = row ? parseFactoryGraph(row.graphJson) : fallback.graph;
    const metrics = await readFactoryMetrics(orgId);

    const metricValues: Record<string, number> = {
      items: metrics.totalItems,
      slack: metrics.slackItems,
      github: metrics.githubItems,
      decisions: metrics.decisions,
      needs_manual: metrics.manualItems,
      runs: metrics.runs,
      completed: metrics.completedRuns,
    };

    return {
      factory: {
        id: factoryId,
        name: row?.name ?? fallback.name,
        description: row?.description ?? fallback.description,
        prompt: row?.prompt ?? fallback.prompt,
        graphVersion: row?.graphVersion ?? graph.version,
        virtual: !row,
      },
      graph,
      metrics,
      nodeMetrics: Object.fromEntries(
        graph.nodes.map((node) => [
          node.id,
          metricValues[node.metricsKey ?? ""] ?? 0,
        ]),
      ),
    };
  },
});
