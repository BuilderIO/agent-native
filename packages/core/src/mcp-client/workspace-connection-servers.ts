/**
 * Remote MCP servers that authenticate with a workspace connection the user
 * already has, so one provider sign-in covers both its REST API and its MCP
 * server. HubSpot is the only verified provider: a token from the HubSpot app
 * behind the workspace connection is accepted by mcp.hubspot.com.
 */
import { getAppConfig } from "../app-config/index.js";
import type { ProviderApiId } from "../provider-api/index.js";
import { runWithRequestContext } from "../server/request-context.js";
import { mcpServerUrlMatchesProvider } from "../shared/mcp-provider-hosts.js";
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

function currentAppId(): string | null {
  const app = getAppConfig().app;
  const value = (app.workspaceId ?? app.id)?.trim().toLowerCase();
  return value || null;
}

/**
 * Add one MCP server per provider whose workspace connection is the
 * principal's own and is granted to this app. Organization-shared and other
 * users' connections never qualify, so an MCP call always acts as the caller.
 * A server the user already added for the same provider wins, so tools are
 * not duplicated.
 */
export async function addWorkspaceConnectionMcpServers(
  servers: Record<string, McpServerConfig>,
  principal: McpPrincipal,
): Promise<void> {
  const appId = currentAppId();
  if (!appId) return;
  const { resolveWorkspaceConnectionForApp } =
    await import("../workspace-connections/store.js");
  for (const [provider, url] of WORKSPACE_CONNECTION_MCP_SERVERS) {
    const alreadyConfigured = Object.values(servers).some(
      (server) =>
        server.type === "http" &&
        mcpServerUrlMatchesProvider(provider, server.url) === true,
    );
    if (alreadyConfigured) continue;
    let connectionId: string | null = null;
    try {
      const resolved = await runWithRequestContext(
        {
          userEmail: principal.userEmail,
          ...(principal.orgId ? { orgId: principal.orgId } : {}),
        },
        () =>
          resolveWorkspaceConnectionForApp({
            appId,
            provider,
            connectionOwnerEmail: principal.userEmail,
            requireConnected: true,
          }),
      );
      if (resolved.available && resolved.connection) {
        connectionId = resolved.connection.id;
      }
    } catch (error) {
      // An unreadable connection must not take down every other MCP server.
      console.warn(
        `[mcp-client] Skipped the ${provider} MCP server: its workspace connection could not be read.`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }
    if (!connectionId) continue;
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
    servers[key] = {
      type: "http",
      url,
      description: `${provider} through your ${provider} workspace connection`,
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
