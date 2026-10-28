/**
 * Remote MCP servers that authenticate with a workspace connection the user
 * already has, so one provider sign-in covers both its REST API and its MCP
 * server. HubSpot is the only verified provider: a token from the HubSpot app
 * behind the workspace connection is accepted by mcp.hubspot.com.
 */
import { getAppConfig } from "../app-config/index.js";
import type { ProviderApiId } from "../provider-api/index.js";
import { runWithRequestContext } from "../server/request-context.js";
import { normalizeMcpUrl } from "../shared/mcp-provider-hosts.js";
import type { McpHttpServerConfig, McpServerConfig } from "./config.js";
import type { McpPrincipal } from "./principal.js";
import { mergedConfigKey } from "./remote-store.js";

export interface McpWorkspaceConnectionAuth {
  provider: ProviderApiId;
  connectionId: string;
  /** The connection owner, who is also the MCP principal. */
  ownerEmail: string;
  orgId: string | null;
  appId: string;
}

const WORKSPACE_CONNECTION_MCP_SERVERS: ReadonlyArray<
  readonly [ProviderApiId, string]
> = [["hubspot", "https://mcp.hubspot.com"]];

// Same order as the agent-chat runtime app id, so MCP sees the grants the
// app's own actions see.
function currentAppId(): string | null {
  const app = getAppConfig().app;
  const value = (app.id ?? app.template ?? app.workspaceId ?? app.packageName)
    ?.trim()
    .toLowerCase();
  return value || null;
}

/**
 * Add one MCP server per provider for which the principal has a connected
 * personal workspace connection granted to this app. Organization- and
 * app-scoped connections never qualify, even ones the principal created: they
 * may have been authorized as another provider user, and an MCP call must act
 * as the caller. A server already configured for the same endpoint wins, so
 * tools are not duplicated.
 */
export async function addWorkspaceConnectionMcpServers(
  servers: Record<string, McpServerConfig>,
  principal: McpPrincipal,
): Promise<void> {
  const appId = currentAppId();
  if (!appId) return;
  const { resolveWorkspaceConnectionsForApp } =
    await import("../workspace-connections/store.js");
  const caller = principal.userEmail.trim().toLowerCase();
  for (const [provider, url] of WORKSPACE_CONNECTION_MCP_SERVERS) {
    const alreadyConfigured = Object.values(servers).some(
      (server) =>
        server.type === "http" &&
        normalizeMcpUrl(server.url) === normalizeMcpUrl(url),
    );
    if (alreadyConfigured) continue;
    const key = mergedConfigKey(
      "user",
      {
        id: `workspace_connection_${provider}`,
        name: provider,
        url,
        createdAt: 0,
      },
      principal.userEmail,
    );
    const description = `${provider} through your ${provider} workspace connection`;
    let connectionIds: string[];
    try {
      const connections = await runWithRequestContext(
        {
          userEmail: principal.userEmail,
          ...(principal.orgId ? { orgId: principal.orgId } : {}),
        },
        () => resolveWorkspaceConnectionsForApp({ appId, provider }),
      );
      connectionIds = connections
        .filter(
          (connection) =>
            connection.status === "connected" &&
            connection.ownerEmail.trim().toLowerCase() === caller &&
            connection.config.workspaceConnectionScope === "user",
        )
        .map((connection) => connection.id);
    } catch (error) {
      // Keep other MCP servers working, but report this one as unreadable
      // rather than as an absent connection.
      servers[key] = {
        type: "http",
        url,
        description,
        configurationError: new Error(
          `The ${provider} workspace connection could not be read.`,
          { cause: error },
        ),
      };
      continue;
    }
    // The server has no account selector, so with two personal connections
    // (e.g. a sandbox and a production portal) any pick could write to the
    // wrong account.
    if (connectionIds.length > 1) {
      servers[key] = {
        type: "http",
        url,
        description,
        configurationError: new Error(
          `You have ${connectionIds.length} personal ${provider} connections for this app, so the ${provider} MCP server can't tell which account to use. Disconnect the extra ones, or add the ${provider} MCP server yourself.`,
        ),
      };
      continue;
    }
    const connectionId = connectionIds[0];
    if (!connectionId) continue;
    servers[key] = {
      type: "http",
      url,
      description,
      workspaceConnection: {
        provider,
        connectionId,
        ownerEmail: principal.userEmail,
        orgId: principal.orgId,
        appId,
      },
    };
  }
}

/**
 * Resolve the bearer for one MCP request from the owner's workspace
 * connection, refreshing it through the connection's own refresh path. The
 * token is sent to the provider's MCP endpoint only; it is never persisted on
 * the server config or shown to the agent.
 */
export async function resolveWorkspaceConnectionMcpBearer(
  auth: McpWorkspaceConnectionAuth,
): Promise<string> {
  const { createProviderApiRuntime } = await import("../provider-api/index.js");
  const runtime = createProviderApiRuntime({ appId: auth.appId });
  const token = await runWithRequestContext(
    {
      userEmail: auth.ownerEmail,
      ...(auth.orgId ? { orgId: auth.orgId } : {}),
    },
    () =>
      runtime.resolveOAuthAccessToken({
        provider: auth.provider,
        connectionId: auth.connectionId,
      }),
  );
  return token.accessToken;
}

export function isWorkspaceConnectionMcpServer(
  config: McpServerConfig,
): config is McpHttpServerConfig & {
  workspaceConnection: McpWorkspaceConnectionAuth;
} {
  return config.type === "http" && !!config.workspaceConnection;
}
