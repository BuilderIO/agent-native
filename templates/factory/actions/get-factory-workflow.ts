import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { findFactoryAutomationDefinition } from "../server/lib/factory-automation-resources.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  isAgentCaller,
  requireWorkflow,
  resolveWorkflowScope,
  withWorkflowFailures,
  workflowSummaryView,
} from "../server/lib/factory-workflow-context.js";
import { readGraphConnections } from "../server/lib/factory-workflow-graph-connections.js";
import {
  planWorkflowJob,
  summarizeWorkflowJob,
} from "../server/lib/factory-workflow-job.js";
import type { WorkflowGraph } from "../server/workflow/contract.js";

// Core cuts a tool result at 50,000 characters of indented JSON, so an agent
// reading a larger graph would lose its tail without being told. Past this
// size an agent gets an outline and reads the nodes it needs by id.
const AGENT_READ_BUDGET_CHARS = 40_000;

function renderedChars(value: unknown): number {
  return JSON.stringify(value, null, 2).length;
}

function outlineOf(graph: WorkflowGraph) {
  return {
    nodes: graph.nodes.map((node) => {
      const operation =
        "operation" in node.settings ? ` ${node.settings.operation}` : "";
      return `${node.id} (${node.name}): ${node.kind}${operation}`;
    }),
    edges: graph.edges.map(
      (edge) =>
        `${edge.id}: ${edge.from.node}.${edge.from.port} -> ${edge.to.node}${edge.back ? " (back)" : ""}`,
    ),
  };
}

export default defineAction({
  description:
    "Read one workflow: its graph, version, whether it is enabled, the version with a clean dry run (a workflow can only be enabled when that is its current version), the health of its scheduled job including any drift from what the graph requires, and connections: each provider the graph needs with its status (connected, not connected, unknown), how to connect it, and the node ids that need it. Pass version to read an older graph. A graph too large for one tool result comes back to an agent as an outline under truncated, with no graph; read those nodes in full with nodeIds.",
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: z.string().trim().min(1).max(64),
    version: z.coerce
      .number()
      .int()
      .min(1)
      .optional()
      .describe("An older version to read; the current one when omitted."),
    nodeIds: z
      .array(z.string().trim().min(1).max(64))
      .min(1)
      .max(50)
      .optional()
      .describe(
        "Only these nodes in full, with the edges that touch them and the workflow settings; the answer says it is partial.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  // A dry run's replay and a save move what this returns while the agent
  // watches, so an identical second call is not a repeat.
  dedupe: false,
  run: async ({ factoryId, workflowId, version, nodeIds }, context) =>
    withWorkflowFailures(async () => {
      const scoped = await resolveWorkflowScope(factoryId, context);
      const workflow = await requireWorkflow(scoped, workflowId);
      let graph = workflow.graph;
      let graphVersion = workflow.version;
      if (version !== undefined && version !== workflow.version) {
        const older = await scoped.store.getWorkflowVersion(
          scoped.scope,
          workflowId,
          version,
        );
        if (!older) {
          fail(`Workflow "${workflowId}" has no version ${version}.`, {
            errorCode: "workflow_version_not_found",
            statusCode: 404,
          });
        }
        graph = older.graph;
        graphVersion = older.version;
      }
      const definition = workflow.automationId
        ? await findFactoryAutomationDefinition(
            scoped.orgId,
            factoryId,
            workflow.automationId,
          )
        : null;
      const summary = {
        ...workflowSummaryView(workflow),
        version: graphVersion,
        currentVersion: workflow.version,
        connections: await readGraphConnections(graph, scoped),
        job: summarizeWorkflowJob(definition, {
          enabled: workflow.enabled,
          schedule: planWorkflowJob(workflow.graph).plan?.schedule,
        }),
      };
      const read = { ...summary, graph };

      if (nodeIds) {
        const missing = nodeIds.filter(
          (id) => !graph.nodes.some((node) => node.id === id),
        );
        if (missing.length > 0) {
          fail(
            `Version ${graphVersion} has no node ${missing.map((id) => `"${id}"`).join(", ")}.`,
            {
              errorCode: "workflow_node_not_found",
              statusCode: 404,
              details: { workflowId, nodeIds: missing },
            },
          );
        }
        const partial = {
          ...read,
          graph: {
            nodes: graph.nodes.filter((node) => nodeIds.includes(node.id)),
            edges: graph.edges.filter(
              (edge) =>
                nodeIds.includes(edge.from.node) ||
                nodeIds.includes(edge.to.node),
            ),
            settings: graph.settings,
          },
          partial: {
            nodeIds,
            nodeCount: graph.nodes.length,
            edgeCount: graph.edges.length,
          },
        };
        if (renderedChars(partial) > AGENT_READ_BUDGET_CHARS) {
          fail(
            "Those nodes are too large to read in one result; ask for fewer.",
            {
              errorCode: "graph_read_too_large",
              statusCode: 413,
              details: { workflowId, nodeIds },
            },
          );
        }
        return partial;
      }

      const chars = renderedChars(read);
      if (!isAgentCaller(context) || chars <= AGENT_READ_BUDGET_CHARS) {
        return read;
      }
      return {
        ...summary,
        truncated: {
          code: "graph_too_large",
          renderedChars: chars,
          limitChars: AGENT_READ_BUDGET_CHARS,
          nodeCount: graph.nodes.length,
          edgeCount: graph.edges.length,
          ...outlineOf(graph),
          readWith:
            "Call again with nodeIds to read nodes in full. A save still needs the whole graph.",
        },
      };
    }),
});
