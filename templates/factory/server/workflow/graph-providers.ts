import type { WorkflowGraph } from "./contract.js";
import type { OperationCatalog } from "./operations.js";

// Factory's own operations read its tables, so they need no connection.
const INTERNAL_PROVIDER = "factory";

interface ProviderUse {
  provider: string;
  nodeId: string;
}

/** Every provider a graph reaches, with the node that reaches it: its pollers, operations, agent calls and AI tools. */
export function providerUsesOfGraph(
  graph: WorkflowGraph,
  catalog: OperationCatalog,
): ProviderUse[] {
  const uses: ProviderUse[] = [];
  for (const node of graph.nodes) {
    const add = (provider: string | undefined) => {
      if (provider && provider !== INTERNAL_PROVIDER) {
        uses.push({ provider, nodeId: node.id });
      }
    };
    const addOperation = (operationId: string) =>
      add(catalog.get(operationId)?.credential.provider);
    switch (node.kind) {
      case "source": {
        const { settings } = node;
        if (settings.source === "inbox-poll") add(settings.poller);
        else if (
          settings.source === "provider-query" ||
          settings.source === "window"
        ) {
          addOperation(settings.operation);
        }
        break;
      }
      case "lookup":
      case "action":
        addOperation(node.settings.operation);
        break;
      case "agent":
        addOperation(`${node.settings.agent}.${node.settings.op}`);
        break;
      case "wait":
        if (node.settings.wait === "condition") {
          addOperation(node.settings.operation);
        }
        break;
      case "ai":
        node.settings.tools.forEach(addOperation);
        break;
      default:
        break;
    }
  }
  return uses;
}

export function providersUsedByGraph(
  graph: WorkflowGraph,
  catalog: OperationCatalog,
): string[] {
  return [
    ...new Set(providerUsesOfGraph(graph, catalog).map((use) => use.provider)),
  ];
}

export function providersUsedByGraphs(
  graphs: readonly WorkflowGraph[],
  catalog: OperationCatalog,
): string[] {
  return [
    ...new Set(graphs.flatMap((graph) => providersUsedByGraph(graph, catalog))),
  ].sort();
}
