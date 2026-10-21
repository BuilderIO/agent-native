import {
  expressionContext,
  type ExpressionContext,
  type WorkflowCatalog,
  type WorkflowGraph,
  type WorkflowNode,
} from "@/lib/workflow-editor";

import type { WorkflowCanvasStrings } from "../strings";

export interface PathSuggestion {
  path: string;
  group: keyof WorkflowCanvasStrings["inspector"]["pathGroup"];
}

export interface FormContext {
  graph: WorkflowGraph;
  node: WorkflowNode;
  catalog: WorkflowCatalog;
  /** What a path in this node may read. */
  expression: ExpressionContext;
  suggestions: PathSuggestion[];
  /** Steps that run before this one, for pickers such as a Wait's watch. */
  upstream: { id: string; name: string }[];
}

/** Item fields every item carries, whichever step made it. */
const ITEM_PATHS = [
  "item.title",
  "item.text",
  "item.url",
  "item.author",
  "item.occurredAt",
  "item.thread.channelId",
  "item.thread.threadTs",
  "item.thread.repo",
  "item.thread.number",
  "item.thread.ticketId",
];

/** The `item.extras.<name>` fields a provider query writes, as its catalog item mapping declares them. */
function declaredExtraPaths(
  node: WorkflowNode,
  catalog: WorkflowCatalog,
): string[] {
  if (node.kind !== "source" || !("operation" in node.settings)) return [];
  const fields =
    catalog.get(node.settings.operation)?.itemMapping?.fields ?? {};
  return Object.keys(fields)
    .filter((field) => field.startsWith("extras."))
    .map((field) => `item.${field}`);
}

function suggestionsFor(
  graph: WorkflowGraph,
  upstream: WorkflowNode[],
  catalog: WorkflowCatalog,
): PathSuggestion[] {
  const { extras, ...own } = graph.settings;
  const settingKeys = Object.keys(own).filter(
    (key) => key !== "checkCadenceMinutes" && key !== "modelCallCap",
  );
  const itemPaths = new Set([
    ...ITEM_PATHS,
    ...upstream.flatMap((node) => declaredExtraPaths(node, catalog)),
  ]);
  return [
    ...[...itemPaths].map(
      (path): PathSuggestion => ({ path, group: "itemField" }),
    ),
    ...settingKeys.map(
      (key): PathSuggestion => ({ path: `settings.${key}`, group: "settings" }),
    ),
    ...Object.keys(extras ?? {}).map(
      (key): PathSuggestion => ({
        path: `settings.extras.${key}`,
        group: "settings",
      }),
    ),
    { path: "run.windowStart", group: "run" },
    ...upstream.map(
      (step): PathSuggestion => ({
        path: `nodes.${scopeKeyOf(step)}.`,
        group: "steps",
      }),
    ),
    ...upstream.flatMap((step) =>
      step.kind === "ai"
        ? Object.keys(step.settings.result).map(
            (key): PathSuggestion => ({
              path: `nodes.${scopeKeyOf(step)}.${key}`,
              group: "aiResult",
            }),
          )
        : [],
    ),
  ];
}

export function buildFormContext(
  graph: WorkflowGraph,
  node: WorkflowNode,
  catalog: WorkflowCatalog,
): FormContext {
  const expression = expressionContext(graph, node.id);
  const upstreamNodes = graph.nodes.filter((candidate) =>
    expression.upstreamKeys.has(scopeKeyOf(candidate)),
  );
  return {
    graph,
    node,
    catalog,
    expression,
    suggestions: suggestionsFor(graph, upstreamNodes, catalog),
    upstream: upstreamNodes.map((candidate) => ({
      id: candidate.id,
      name: scopeKeyOf(candidate),
    })),
  };
}

function scopeKeyOf(node: WorkflowNode): string {
  return node.kind === "lookup" && node.settings.into
    ? node.settings.into
    : node.name;
}
