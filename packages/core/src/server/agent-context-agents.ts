import { normalizeAgentId } from "../shared/first-party-agents.js";
import {
  discoverAgents,
  discoverAgentsWithDirectoryStatus,
  type DiscoverAgentsOptions,
  type DiscoveredAgent,
  type DiscoveredAgentsWithDirectoryStatus,
} from "./agent-discovery.js";

/**
 * Narrows the peers an app's own agent is told about (prompt app lists, the
 * @-mention menu, describe-workspace-apps). It runs inside the request, so it
 * can read the caller's org settings. A thrown error fails that discovery; it
 * never falls back to the unfiltered list.
 */
export type AgentContextAgentFilter = (
  agents: DiscoveredAgent[],
) => DiscoveredAgent[] | Promise<DiscoveredAgent[]>;

// Pinned to globalThis so a template plugin and the framework's agent chat
// share one registry even when Core loads through different bundle graphs.
const REGISTRY_KEY = Symbol.for("@agent-native/core/agent-context-filters");

type GlobalWithFilters = {
  [REGISTRY_KEY]?: Map<string, AgentContextAgentFilter>;
};

function filters(): Map<string, AgentContextAgentFilter> {
  const g = globalThis as GlobalWithFilters;
  g[REGISTRY_KEY] ??= new Map();
  return g[REGISTRY_KEY];
}

/**
 * Register the filter for one app's agent context. Re-registering replaces
 * the previous filter. Explicit routing (`call-agent`, `findAgent`) and every
 * other `discoverAgents` caller are unaffected.
 */
export function registerAgentContextAgentFilter(
  selfAppId: string,
  filter: AgentContextAgentFilter,
): () => void {
  const key = normalizeAgentId(selfAppId);
  filters().set(key, filter);
  return () => {
    if (filters().get(key) === filter) filters().delete(key);
  };
}

async function applyAgentContextAgentFilter(
  selfAppId: string | undefined,
  agents: DiscoveredAgent[],
): Promise<DiscoveredAgent[]> {
  const filter = selfAppId
    ? filters().get(normalizeAgentId(selfAppId))
    : undefined;
  return filter ? filter(agents) : agents;
}

/** `discoverAgents` for what this app's agent is shown about its peers. */
export async function discoverAgentContextAgents(
  selfAppId?: string,
  options?: DiscoverAgentsOptions,
): Promise<DiscoveredAgent[]> {
  return applyAgentContextAgentFilter(
    selfAppId,
    await discoverAgents(selfAppId, options),
  );
}

export async function discoverAgentContextAgentsWithDirectoryStatus(
  selfAppId?: string,
  options?: DiscoverAgentsOptions,
): Promise<DiscoveredAgentsWithDirectoryStatus> {
  const discovery = await discoverAgentsWithDirectoryStatus(selfAppId, options);
  return {
    ...discovery,
    agents: await applyAgentContextAgentFilter(selfAppId, discovery.agents),
  };
}
