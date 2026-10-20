import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import type { WorkflowGraph } from "../workflow/contract.js";
import { providerUsesOfGraph } from "../workflow/graph-providers.js";
import {
  readProviderConnections,
  type ProviderConnection,
} from "./factory-workflow-connections.js";

/** One provider a graph needs, its connection status, and the nodes that need it. */
interface WorkflowConnection extends ProviderConnection {
  nodes: string[];
}

/**
 * The connection status of every provider a graph reaches, from the same
 * check `describe-workflow-node-catalog` reports. A check that cannot run
 * reports every provider as `unknown`: it is never read as not connected, and
 * never lets a save that already landed look like it failed.
 */
export async function readGraphConnections(
  graph: WorkflowGraph,
  identity: { userEmail: string; orgId: string },
): Promise<WorkflowConnection[]> {
  const nodesByProvider = new Map<string, string[]>();
  for (const { provider, nodeId } of providerUsesOfGraph(
    graph,
    OPERATION_CATALOG,
  )) {
    nodesByProvider.set(provider, [
      ...(nodesByProvider.get(provider) ?? []),
      nodeId,
    ]);
  }
  if (nodesByProvider.size === 0) return [];

  let reported: ProviderConnection[];
  try {
    reported = await readProviderConnections([...nodesByProvider.keys()], {
      userEmail: identity.userEmail,
      orgId: identity.orgId,
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "The check could not run.";
    reported = [...nodesByProvider.keys()].map((provider) => ({
      provider,
      status: "unknown" as const,
      connectWith: null,
      detail,
    }));
  }
  const byProvider = new Map(reported.map((entry) => [entry.provider, entry]));
  return [...nodesByProvider].map(([provider, nodes]) => ({
    ...(byProvider.get(provider) ?? {
      provider,
      status: "unknown" as const,
      connectWith: null,
      detail: "The check did not report on this provider.",
    }),
    nodes: [...new Set(nodes)],
  }));
}
