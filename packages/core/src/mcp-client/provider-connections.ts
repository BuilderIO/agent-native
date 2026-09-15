import {
  hasMcpProviderMatchRules,
  mcpServerUrlMatchesProvider,
} from "../shared/mcp-provider-hosts.js";
import { listRemoteServers, type RemoteMcpScope } from "./remote-store.js";

export interface ConnectedMcpProviderServer {
  id: string;
  name: string;
  url: string;
  scope: RemoteMcpScope;
}

export interface ConnectedMcpProviderResult {
  /** Saved remote MCP servers whose URL belongs to this provider. */
  servers: ConnectedMcpProviderServer[];
  /**
   * Scopes whose saved server list could not be read. A caller that reports
   * "not connected" while this is non-empty is guessing, so surface it instead
   * of folding an unreadable scope into an empty one.
   */
  unreadableScopes: RemoteMcpScope[];
}

/**
 * Find the remote MCP servers a user or org has saved for one catalog provider.
 *
 * Settings answers "is Notion connected?" from this list, so any agent-facing
 * status action that answers the same question from a different registry (an
 * app-local OAuth account, a provider API key) must consult this too or the two
 * surfaces will disagree in front of the user.
 */
export async function findConnectedMcpServersForProvider(options: {
  providerId: string;
  userEmail?: string | null;
  orgId?: string | null;
}): Promise<ConnectedMcpProviderResult> {
  const { providerId } = options;
  // Answering "no servers" for a provider this module has no rules for is the
  // exact failure this helper exists to remove: it is indistinguishable from a
  // real "not connected" and would be reported to a user as fact.
  if (!hasMcpProviderMatchRules(providerId)) {
    throw new Error(
      `No MCP provider match rules for "${providerId}". Add it to MCP_PROVIDER_ENDPOINTS or MCP_LINK_HOSTS before querying its connection status.`,
    );
  }

  const scopes: Array<{ scope: RemoteMcpScope; scopeId: string }> = [];
  if (options.userEmail) {
    scopes.push({ scope: "user", scopeId: options.userEmail });
  }
  if (options.orgId) scopes.push({ scope: "org", scopeId: options.orgId });

  const servers: ConnectedMcpProviderServer[] = [];
  const unreadableScopes: RemoteMcpScope[] = [];

  for (const { scope, scopeId } of scopes) {
    let saved;
    try {
      saved = await listRemoteServers(scope, scopeId);
    } catch {
      unreadableScopes.push(scope);
      continue;
    }
    for (const server of saved) {
      if (mcpServerUrlMatchesProvider(providerId, server.url) !== true) {
        continue;
      }
      servers.push({
        id: server.id,
        name: server.name,
        url: server.url,
        scope,
      });
    }
  }

  return { servers, unreadableScopes };
}
