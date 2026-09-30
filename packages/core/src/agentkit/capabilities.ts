import type { CredentialContext } from "../credentials/index.js";
import { parseMergedKey } from "../mcp-client/remote-store.js";
import { isMcpToolAllowedForRequest } from "../mcp-client/visibility.js";
import { hasOAuthTokens } from "../oauth-tokens/index.js";
import {
  defaultProviderApiCredentialResolver,
  getProviderApiConfig,
  isProviderApiId,
  listProviderApiIdsForTemplateUse,
  type ProviderApiAuthKind,
  type ProviderApiId,
} from "../provider-api/index.js";
import { getMcpManagerForCurrentRequest } from "../server/agent-chat/mcp-glue.js";
import {
  getRequestContext,
  runWithRequestContext,
} from "../server/request-context.js";
import { resolveWorkspaceConnectionForApp } from "../workspace-connections/index.js";

export type AgentKitCapabilityAppId = "design" | "slides";

export interface AgentKitIntegrationCapability {
  id: string;
  label: string;
  kind: "provider-api" | "mcp";
}

export interface AgentKitCapabilityCatalog {
  sources: {
    figma: { available: boolean };
  };
  integrations: AgentKitIntegrationCapability[];
}

async function inCapabilityScope<T>(
  context: CredentialContext,
  read: () => T | Promise<T>,
): Promise<T> {
  if (!context.userEmail.trim()) {
    throw new Error("Workspace connections require an authenticated user.");
  }
  return runWithRequestContext(
    {
      ...getRequestContext(),
      userEmail: context.userEmail.trim().toLowerCase(),
      orgId: context.orgId ?? undefined,
      credentialScope: context.credentialScope,
    },
    read,
  );
}

function credentialGroups(
  auth: ProviderApiAuthKind,
  provider: ProviderApiId,
): string[][] {
  switch (auth.type) {
    case "none":
      return [];
    case "bearer":
      return auth.keys.map((key) => [key]);
    case "basic":
      return [[auth.usernameKey, auth.passwordKey]];
    case "basic-raw":
    case "api-key-header":
      return [[auth.key]];
    case "google-service-account":
      return [["GOOGLE_APPLICATION_CREDENTIALS_JSON"]];
    case "oauth-bearer":
      return [[getProviderApiConfig(provider).credentialKeys[0] ?? provider]];
    case "oauth-bearer-or-api-key-header":
    case "oauth-bearer-or-bearer-key":
      return (auth.fallbackKeys ?? [auth.key]).map((key) => [key]);
    case "oauth-bearer-or-basic":
      return [[auth.usernameKey, auth.passwordKey]];
    case "prometheus":
      return [
        ["PROMETHEUS_BEARER_TOKEN"],
        ["PROMETHEUS_USERNAME", "PROMETHEUS_PASSWORD"],
      ];
  }
}

function workspaceProvider(auth: ProviderApiAuthKind) {
  return "workspaceProvider" in auth ? auth.workspaceProvider : undefined;
}

async function groupHasCredentials(
  appId: AgentKitCapabilityAppId,
  provider: ProviderApiId,
  keys: readonly string[],
  context: CredentialContext,
): Promise<boolean> {
  const config = getProviderApiConfig(provider);
  const resolved = await Promise.all(
    keys.map((key) =>
      defaultProviderApiCredentialResolver({
        appId,
        provider,
        key,
        ctx: context,
        workspaceProvider: workspaceProvider(config.auth),
        localCredentialSource: `${appId}_local`,
      }),
    ),
  );
  return resolved.every(Boolean);
}

async function isIntegrationAvailable(
  appId: AgentKitCapabilityAppId,
  provider: ProviderApiId,
  context: CredentialContext,
): Promise<boolean> {
  const config = getProviderApiConfig(provider);
  if (config.auth.type === "oauth-bearer") {
    if (config.auth.workspaceProvider) {
      const connection = await resolveWorkspaceConnectionForApp({
        appId,
        provider: config.auth.workspaceProvider,
        requireConnected: true,
      });
      return Boolean(
        connection.available &&
        connection.connection?.accountId &&
        (await hasOAuthTokens(
          config.auth.oauthProvider,
          connection.connection.ownerEmail,
          connection.connection.accountId,
        )),
      );
    }
    return hasOAuthTokens(config.auth.oauthProvider, context.userEmail);
  }
  if (
    config.auth.type === "oauth-bearer-or-api-key-header" ||
    config.auth.type === "oauth-bearer-or-bearer-key" ||
    config.auth.type === "oauth-bearer-or-basic"
  ) {
    const connection = await resolveWorkspaceConnectionForApp({
      appId,
      provider: config.auth.workspaceProvider,
      requireConnected: true,
    });
    if (
      connection.available &&
      connection.connection?.accountId &&
      (await hasOAuthTokens(
        config.auth.oauthProvider,
        connection.connection.ownerEmail,
        connection.connection.accountId,
      ))
    ) {
      return true;
    }
  }
  const groups = credentialGroups(config.auth, provider);
  if (groups.length === 0) return true;
  for (const group of groups) {
    if (await groupHasCredentials(appId, provider, group, context)) return true;
  }
  return false;
}

function displayLabel(label: string): string {
  return label.replace(/(?: REST)? API$/i, "");
}

function mcpServerLabel(serverId: string): string {
  const label = parseMergedKey(serverId)?.name ?? serverId;
  return label
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[-_]+/g, " ")
    .trim()
    .slice(0, 80);
}

function isMcpServerInScope(serverId: string): boolean {
  return (
    parseMergedKey(serverId)?.scope !== "org" ||
    Boolean(getRequestContext()?.orgId)
  );
}

async function listConnectedMcpIntegrations(): Promise<
  AgentKitIntegrationCapability[]
> {
  const manager = await getMcpManagerForCurrentRequest();
  const config = manager.getConfig();
  if (!config) return [];
  const connected = manager.getStatus().connectedServers;
  return connected.flatMap((serverId) => {
    const serverConfig = config.servers[serverId];
    if (!serverConfig || !isMcpServerInScope(serverId)) {
      return [];
    }
    const hasVisibleTools = manager
      .getToolsForServer(serverId)
      .some((tool) => isMcpToolAllowedForRequest(tool.name));
    return hasVisibleTools
      ? [
          {
            id: `mcp:${serverId}`,
            label: mcpServerLabel(serverId),
            kind: "mcp",
          },
        ]
      : [];
  });
}

export async function isAgentKitFigmaSourceAvailable(
  context: CredentialContext,
): Promise<boolean> {
  return inCapabilityScope(
    context,
    () =>
      listProviderApiIdsForTemplateUse("design").includes("figma") &&
      isIntegrationAvailable("design", "figma", context),
  );
}

export async function listAgentKitCapabilities(
  appId: AgentKitCapabilityAppId,
  context: CredentialContext,
): Promise<AgentKitCapabilityCatalog> {
  return inCapabilityScope(context, async () => {
    const supported = listProviderApiIdsForTemplateUse(appId);
    const figmaAvailable = await isAgentKitFigmaSourceAvailable(context);
    const integrations = await Promise.all(
      supported
        .filter((provider) => provider !== "figma")
        .map(async (id): Promise<AgentKitIntegrationCapability | null> => {
          const config = getProviderApiConfig(id);
          return (await isIntegrationAvailable(appId, id, context))
            ? {
                id,
                label: displayLabel(config.label),
                kind: "provider-api" as const,
              }
            : null;
        }),
    );
    return {
      sources: { figma: { available: figmaAvailable } },
      integrations: [
        ...integrations.filter(
          (integration): integration is AgentKitIntegrationCapability =>
            integration !== null,
        ),
        ...(await listConnectedMcpIntegrations()),
      ],
    };
  });
}

export async function readAgentKitIntegrationIntent(
  appId: AgentKitCapabilityAppId,
  provider: string,
  context: CredentialContext,
): Promise<{ id: string; title: string; context: string } | null> {
  return inCapabilityScope(context, async () => {
    if (provider.startsWith("mcp:")) {
      const serverId = provider.slice("mcp:".length);
      const manager = await getMcpManagerForCurrentRequest();
      const config = manager.getConfig()?.servers[serverId];
      if (
        !serverId ||
        !isMcpServerInScope(serverId) ||
        !manager.hasServer(serverId) ||
        !config ||
        !manager
          .getToolsForServer(serverId)
          .some((tool) => isMcpToolAllowedForRequest(tool.name))
      ) {
        return null;
      }
      const label = mcpServerLabel(serverId);
      return {
        id: provider,
        title: label,
        context: [
          `The user selected the connected ${label} MCP integration for this request.`,
          `This is an invocation intent, not retrieved data. Use only the available tools from the selected ${label} MCP server when relevant, and do not claim an operation succeeded unless you actually called the tool.`,
        ].join("\n"),
      };
    }
    const supported = listProviderApiIdsForTemplateUse(appId);
    if (
      !isProviderApiId(provider) ||
      !supported.includes(provider) ||
      provider === "figma" ||
      !(await isIntegrationAvailable(appId, provider, context))
    ) {
      return null;
    }
    const label = displayLabel(getProviderApiConfig(provider).label);
    return {
      id: provider,
      title: label,
      context: [
        `The user selected the connected ${label} integration for this request.`,
        `This is an invocation intent, not retrieved data. Use the available ${label} provider tools only when relevant, and do not claim an operation succeeded unless you actually called the tool.`,
      ].join("\n"),
    };
  });
}
