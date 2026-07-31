import { z } from "zod";

export const factoryNodeKindSchema = z.enum([
  "source",
  "transform",
  "decision",
  "gate",
  "agent",
  "system",
  "terminal",
]);
export type FactoryNodeKind = z.infer<typeof factoryNodeKindSchema>;

export const factoryProviderSchema = z.enum([
  "slack",
  "github",
  "builder",
  "claude",
  "codex",
  "human",
  "factory",
]);
export type FactoryProvider = z.infer<typeof factoryProviderSchema>;

export const factoryGraphNodeSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  kind: factoryNodeKindSchema,
  provider: factoryProviderSchema.optional(),
  agent: z.string().trim().max(120).optional(),
  metricsKey: z.string().trim().max(120).optional(),
  position: z.object({
    x: z.number().finite().min(0).max(4000),
    y: z.number().finite().min(0).max(2400),
  }),
});
export type FactoryGraphNode = z.infer<typeof factoryGraphNodeSchema>;

export const factoryGraphEdgeSchema = z.object({
  id: z.string().min(1).max(120),
  source: z.string().min(1).max(120),
  target: z.string().min(1).max(120),
  label: z.string().trim().max(160).default(""),
  condition: z.string().trim().max(500).default(""),
});
export type FactoryGraphEdge = z.infer<typeof factoryGraphEdgeSchema>;

export const factoryGraphSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  executionMode: z.literal("blueprint").default("blueprint"),
  nodes: z.array(factoryGraphNodeSchema).max(100),
  edges: z.array(factoryGraphEdgeSchema).max(200),
});
export type FactoryGraph = z.infer<typeof factoryGraphSchema>;

export function normalizeFactoryGraph(value: unknown): FactoryGraph {
  const graph = factoryGraphSchema.parse(value);
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(`Factory graph contains duplicate node id: ${node.id}`);
    }
    nodeIds.add(node.id);
  }

  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      throw new Error(`Factory graph contains duplicate edge id: ${edge.id}`);
    }
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new Error(
        `Factory graph edge ${edge.id} references a missing node.`,
      );
    }
    if (edge.source === edge.target) {
      throw new Error(`Factory graph edge ${edge.id} cannot self-reference.`);
    }
    edgeIds.add(edge.id);
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}

export function defaultFactoryGraph(): FactoryGraph {
  return {
    version: 1,
    name: "Product feedback to shipped change",
    description:
      "Observe product signals, classify them safely, and keep a human in the loop before work starts.",
    executionMode: "blueprint",
    nodes: [
      {
        id: "slack-feedback",
        label: "Product feedback",
        description: "Watch the configured feedback channel.",
        kind: "source",
        provider: "slack",
        metricsKey: "slack",
        position: { x: 48, y: 170 },
      },
      {
        id: "github-evidence",
        label: "Pull request evidence",
        description: "Read PR metadata, checks, and review state.",
        kind: "source",
        provider: "github",
        metricsKey: "github",
        position: { x: 48, y: 420 },
      },
      {
        id: "normalize-context",
        label: "Normalize context",
        description: "Deduplicate and preserve source links and coverage.",
        kind: "transform",
        provider: "factory",
        metricsKey: "items",
        position: { x: 310, y: 290 },
      },
      {
        id: "ai-triage",
        label: "Enabled rules (parallel)",
        description:
          "Evaluate each enabled rule against the same evidence with structured guards.",
        kind: "decision",
        provider: "factory",
        agent: "Factory agent",
        metricsKey: "decisions",
        position: { x: 570, y: 290 },
      },
      {
        id: "human-gate",
        label: "Human review",
        description: "Review shadow decisions and approve a bounded run.",
        kind: "gate",
        provider: "human",
        metricsKey: "needs_manual",
        position: { x: 830, y: 155 },
      },
      {
        id: "builder-agent",
        label: "Approved coding run",
        description: "Start approved work through the configured executor.",
        kind: "agent",
        provider: "builder",
        agent: "Builder",
        metricsKey: "runs",
        position: { x: 830, y: 420 },
      },
      {
        id: "shipped-change",
        label: "PR and delivery",
        description: "Reconcile callbacks and preserve the terminal outcome.",
        kind: "terminal",
        provider: "github",
        metricsKey: "completed",
        position: { x: 1090, y: 420 },
      },
    ],
    edges: [
      {
        id: "slack-to-normalize",
        source: "slack-feedback",
        target: "normalize-context",
        label: "feedback",
        condition: "",
      },
      {
        id: "github-to-normalize",
        source: "github-evidence",
        target: "normalize-context",
        label: "evidence",
        condition: "",
      },
      {
        id: "normalize-to-triage",
        source: "normalize-context",
        target: "ai-triage",
        label: "complete or partial context",
        condition: "",
      },
      {
        id: "triage-to-human",
        source: "ai-triage",
        target: "human-gate",
        label: "shadow decision",
        condition: "always review until a rule is explicitly promoted",
      },
      {
        id: "human-to-agent",
        source: "human-gate",
        target: "builder-agent",
        label: "approved proposal",
        condition: "guard checks pass and a person approves",
      },
      {
        id: "agent-to-shipped",
        source: "builder-agent",
        target: "shipped-change",
        label: "callback and reconciliation",
        condition: "",
      },
    ],
  };
}
