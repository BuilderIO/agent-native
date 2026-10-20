import { getWorkspaceConnectionProvider } from "@agent-native/core/client/integrations";

import type {
  ProviderConnection,
  ProviderConnectionStatus,
} from "../../../server/lib/factory-workflow-connections.js";
import type { WorkflowGraph } from "../../../server/workflow/contract.js";
import {
  providerUsesOfGraph,
  providersUsedByGraph,
  providersUsedByGraphs,
} from "../../../server/workflow/graph-providers.js";
import type { OperationCatalog } from "../../../server/workflow/operations.js";

export { providersUsedByGraph, providersUsedByGraphs };

export type { ProviderConnection };

export type ReadinessKind = "ready" | "needs_credentials" | "needs_attention";

/** Which of the catalog's four status words a badge shows. */
type StatusWord =
  | "connected"
  | "notConnected"
  | "couldNotCheck"
  | "needsAttention";

export interface Readiness {
  readiness: ReadinessKind;
  word: StatusWord;
}

export interface ConnectionRow extends Readiness {
  provider: string;
  /** Where a person connects it. */
  connectWith: ProviderConnection["connectWith"];
  /** Why it is not connected, in the check's own words. */
  detail?: string;
}

const READINESS: Record<ProviderConnectionStatus, Readiness> = {
  connected: { readiness: "ready", word: "connected" },
  "not connected": { readiness: "needs_credentials", word: "notConnected" },
  unknown: { readiness: "needs_attention", word: "couldNotCheck" },
};

/** Where connecting a provider happens. */
type ConnectTarget =
  /** The shared sign-in popup, which grants the connection to this app. */
  | { kind: "oauth"; provider: string }
  /** A page in Dispatch: Integrations for a catalog provider, API keys for any other key. */
  | { kind: "dispatch"; page: "integrations" | "api-keys" }
  /** One of this app's own Settings pages. */
  | { kind: "settings"; page: string; sub?: string };

/**
 * Where a person connects a provider. Builder and email are this app's own, so
 * they stay in its Settings. In a workspace, a provider in the workspace
 * connection catalog is connected in Dispatch's Integrations, and any other key
 * is entered in Dispatch's API keys. Outside a workspace there is no Dispatch: a
 * catalog provider with OAuth opens its sign-in when it is known to be missing,
 * and every other key goes to this app's API keys.
 */
export function connectTarget(
  provider: string,
  connectWith: ProviderConnection["connectWith"],
  where: {
    workspace: boolean;
    /** False when the provider is not known to be missing: a failed check is no reason to start a sign-in. */
    signIn: boolean;
  },
): ConnectTarget {
  if (provider === "builder") {
    return { kind: "settings", page: "integrations", sub: "builder" };
  }
  if (provider === "email") return { kind: "settings", page: "api-keys" };
  const catalogued = getWorkspaceConnectionProvider(provider);
  if (where.workspace) {
    return { kind: "dispatch", page: catalogued ? "integrations" : "api-keys" };
  }
  if (
    where.signIn &&
    connectWith === "workspace-connection" &&
    catalogued?.oauth
  ) {
    return { kind: "oauth", provider };
  }
  return { kind: "settings", page: "api-keys" };
}

/**
 * One row per provider the workflows use. A provider the check did not report
 * on shows as not checked, never as connected and never left out.
 */
export function connectionRows(
  used: readonly string[],
  reported: readonly ProviderConnection[],
): ConnectionRow[] {
  const byProvider = new Map(reported.map((entry) => [entry.provider, entry]));
  return used.map((provider) => {
    const entry = byProvider.get(provider);
    const readiness = READINESS[entry?.status ?? "unknown"];
    return {
      provider,
      ...readiness,
      connectWith: entry?.connectWith ?? null,
      ...(entry?.detail ? { detail: entry.detail } : {}),
    };
  });
}

/** A provider a graph uses that is known to be missing, and the steps that need it. */
export interface MissingConnection {
  provider: string;
  connectWith: ProviderConnection["connectWith"];
  detail?: string;
  nodeIds: string[];
}

/**
 * The providers a graph on screen needs that are not connected. A provider
 * the check did not report on, or could not check, is not listed: only a
 * known gap is called one.
 */
export function missingConnections(
  graph: WorkflowGraph,
  catalog: OperationCatalog,
  reported: readonly ProviderConnection[] | undefined,
): MissingConnection[] {
  if (!reported) return [];
  const byProvider = new Map(reported.map((entry) => [entry.provider, entry]));
  const nodesByProvider = new Map<string, string[]>();
  for (const { provider, nodeId } of providerUsesOfGraph(graph, catalog)) {
    nodesByProvider.set(provider, [
      ...(nodesByProvider.get(provider) ?? []),
      nodeId,
    ]);
  }
  return [...nodesByProvider].flatMap(([provider, nodeIds]) => {
    const entry = byProvider.get(provider);
    if (entry?.status !== "not connected") return [];
    return [
      {
        provider,
        connectWith: entry.connectWith,
        ...(entry.detail ? { detail: entry.detail } : {}),
        nodeIds: [...new Set(nodeIds)],
      },
    ];
  });
}

/** The readiness of the email provider that failure alerts use. */
export function emailReadiness(
  status: "ready" | "not-configured" | "misconfigured" | "unavailable",
): Readiness {
  switch (status) {
    case "ready":
      return READINESS.connected;
    case "not-configured":
      return READINESS["not connected"];
    case "misconfigured":
      return { readiness: "needs_attention", word: "needsAttention" };
    case "unavailable":
      return READINESS.unknown;
  }
}

/** The providers each step is waiting on, by node id, for marking the canvas. */
export function unconnectedByNode(
  missing: readonly MissingConnection[],
): Record<string, string[]> {
  const byNode: Record<string, string[]> = {};
  for (const { provider, nodeIds } of missing) {
    for (const nodeId of nodeIds) {
      byNode[nodeId] = [...(byNode[nodeId] ?? []), provider];
    }
  }
  return byNode;
}
