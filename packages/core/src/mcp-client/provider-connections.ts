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
  servers: ConnectedMcpProviderServer[];
  unreadableScopes: RemoteMcpScope[];
}

export async function findConnectedMcpServersForProvider(options: {
  providerId: string;
  userEmail?: string | null;
  orgId?: string | null;
}): Promise<ConnectedMcpProviderResult> {
  const { providerId } = options;
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
