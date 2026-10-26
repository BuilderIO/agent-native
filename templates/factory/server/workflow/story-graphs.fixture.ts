import {
  workflowGraphSchema,
  workflowNodeSchema,
  type NodeKind,
  type WorkflowGraph,
  type WorkflowNode,
} from "./contract.js";
import type { OperationCatalog, OperationDefinition } from "./operations.js";
import bugReportToBuilder from "./stories/01-bug-report-to-builder/workflow.json";
import builderToMerge from "./stories/02-builder-to-merge/workflow.json";
import morningDigest from "./stories/03-morning-digest/workflow.json";
import hotLeadRouting from "./stories/04-hot-lead-routing/workflow.json";
import afterEveryCustomerCall from "./stories/05-after-every-customer-call/workflow.json";
import supportTicketRouting from "./stories/06-support-ticket-routing/workflow.json";
import incidentToPostmortem from "./stories/07-incident-to-postmortem/workflow.json";
import securityAlertToSafeFix from "./stories/08-security-alert-to-safe-fix/workflow.json";
import activationNudge from "./stories/09-activation-nudge/workflow.json";
import cloudCostSpike from "./stories/10-cloud-cost-spike/workflow.json";

type Json = Record<string, unknown>;

export const fixed = (value: unknown) => ({ mode: "fixed", value });
export const fromPath = (path: string) => ({ mode: "path", path });
export const aiWritten = (instruction: string) => ({
  mode: "ai",
  instruction,
});
export const rule = (left: string, op: string, right?: unknown) =>
  right === undefined ? { left, op } : { left, op, right };

/** An unparsed node, for tests that check what the schema accepts and rejects. */
export function candidateNode(kind: NodeKind, settings: unknown, name = "n1") {
  return {
    id: name,
    name,
    kind,
    position: { x: 0, y: 0 },
    settings,
  };
}

export function parseNode(
  kind: NodeKind,
  settings: unknown,
  name = "n1",
): WorkflowNode {
  return workflowNodeSchema.parse(candidateNode(kind, settings, name));
}

export type NodeSpec = [name: string, kind: NodeKind, settings: Json];
export type EdgeSpec = [from: string, port: string, to: string, back?: number];

/** Builds a graph from compact specs and runs it through the real schema. */
export function buildGraph(spec: {
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  settings?: Json;
}): WorkflowGraph {
  return workflowGraphSchema.parse({
    nodes: spec.nodes.map(([name, kind, settings], index) => ({
      id: name,
      name,
      kind,
      position: { x: index * 220, y: 0 },
      settings,
    })),
    edges: spec.edges.map(([from, port, to, back], index) => ({
      id: `e${index + 1}`,
      from: { node: from, port },
      to: { node: to },
      ...(back === undefined ? {} : { back: { maxIterations: back } }),
    })),
    settings: spec.settings ?? {},
  });
}

export function catalogOf(
  operations: readonly OperationDefinition[],
): OperationCatalog {
  const byId = new Map(operations.map((def) => [def.id, def]));
  return { get: (id) => byId.get(id) };
}

/**
 * Each story's graph lives once, in its folder's `workflow.json`; this loads
 * them through the real schema, so a graph the contract rejects fails here
 * instead of in the spec that uses it.
 */
export const STORY_GRAPHS = {
  "bug-report-to-builder": workflowGraphSchema.parse(bugReportToBuilder),
  "builder-to-merge": workflowGraphSchema.parse(builderToMerge),
  "morning-digest": workflowGraphSchema.parse(morningDigest),
  "hot-lead-routing": workflowGraphSchema.parse(hotLeadRouting),
  "after-every-customer-call": workflowGraphSchema.parse(
    afterEveryCustomerCall,
  ),
  "support-ticket-routing": workflowGraphSchema.parse(supportTicketRouting),
  "incident-to-postmortem": workflowGraphSchema.parse(incidentToPostmortem),
  "security-alert-to-safe-fix": workflowGraphSchema.parse(
    securityAlertToSafeFix,
  ),
  "activation-nudge": workflowGraphSchema.parse(activationNudge),
  "cloud-cost-spike": workflowGraphSchema.parse(cloudCostSpike),
} satisfies Record<string, WorkflowGraph>;

export type StoryKey = keyof typeof STORY_GRAPHS;
