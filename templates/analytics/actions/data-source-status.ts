import { defineAction } from "@agent-native/core";
import {
  getWorkspaceConnectionProvider,
  listWorkspaceConnectionProvidersForTemplate,
} from "@agent-native/core/connections";
import { buildDeepLink } from "@agent-native/core/server";
import {
  listWorkspaceConnectionGrants,
  listWorkspaceConnections,
  summarizeWorkspaceConnectionProviderForApp,
  type SerializedWorkspaceConnectionGrant,
  type SerializedWorkspaceConnection,
} from "@agent-native/core/workspace-connections";
import { z } from "zod";

import {
  credentialProviderConfigs,
  resolveCredentialConfigs,
} from "../server/lib/credential-keys";
import { hasCredential } from "../server/lib/credentials";
import { tryRequestCredentialContext } from "../server/lib/credentials-context";
import { getGitHubAccessToken } from "../server/lib/github-oauth";
import { resolveAnalyticsProviderCredential } from "../server/lib/provider-credentials";

const APP_ID = "analytics";
const DATA_SOURCES_SETUP_LINK = buildDeepLink({
  app: APP_ID,
  view: "data-sources",
  to: "/data-sources",
});

const BUILT_IN_FIRST_PARTY_PROVIDER = {
  provider: "first-party",
  label: "First-party Analytics",
  configured: true,
  configuredKeys: [],
  missingRequiredKeys: [],
  optionalKeys: [],
  queryAction: "query-agent-native-analytics",
} as const;

function summarizeWorkspaceConnections(
  providerId: string,
  connections: SerializedWorkspaceConnection[],
  grants: SerializedWorkspaceConnectionGrant[],
) {
  return summarizeWorkspaceConnectionProviderForApp({
    providerId,
    appId: APP_ID,
    connections,
    grants,
  });
}

async function listWorkspaceConnectionsForStatus(): Promise<{
  connections: SerializedWorkspaceConnection[];
  grants: SerializedWorkspaceConnectionGrant[];
  error: string | null;
}> {
  try {
    return {
      connections: await listWorkspaceConnections({ includeDisabled: true }),
      grants: await listWorkspaceConnectionGrants({ appId: APP_ID }),
      error: null,
    };
  } catch (err) {
    return {
      connections: [],
      grants: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default defineAction({
  description:
    "List which analytics data sources are available without revealing secret values. This always includes the built-in first-party Analytics event store, which is queried with `query-agent-native-analytics`; it also reports configured credentials and granted workspace connections. The result includes `hasConnectedExternalDataSources`, `connectedExternalDataSourceCount`, and `dataSourcesSetupLink`; when a requested provider is unavailable, use that link for contextual setup guidance. The `key` arg accepts exact credential names like JIRA_API_TOKEN and provider aliases like jira, pylon, bigquery, github, hubspot, gong, or slack.",
  schema: z.object({
    key: z
      .string()
      .optional()
      .describe(
        "Optional credential key or provider alias to check, e.g. jira, pylon, github, bigquery, or SENTRY_AUTH_TOKEN",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const ctx = tryRequestCredentialContext();
    if (!ctx) {
      return {
        error: "missing_api_key",
        key: "AUTH",
        label: "Authentication",
        message: "Sign in to view credential status.",
        settingsPath: "/data-sources",
        dataSourcesSetupLink: DATA_SOURCES_SETUP_LINK,
      };
    }

    const { configs, known } = resolveCredentialConfigs(args.key);
    if (args.key && !known) {
      return { error: `Unknown credential key: ${args.key}` };
    }

    const workspace = await listWorkspaceConnectionsForStatus();
    const workspaceCatalog =
      listWorkspaceConnectionProvidersForTemplate(APP_ID);
    const workspaceProviderIds = [
      ...new Set([
        ...workspaceCatalog.map((provider) => provider.id),
        ...workspace.connections.map((connection) => connection.provider),
      ]),
    ];
    const workspaceProviderStatuses = workspaceProviderIds.map((providerId) => {
      const catalogProvider =
        workspaceCatalog.find((provider) => provider.id === providerId) ??
        getWorkspaceConnectionProvider(providerId);
      return {
        id: providerId,
        label: catalogProvider?.label ?? providerId,
        description: catalogProvider?.description ?? null,
        capabilities: catalogProvider ? [...catalogProvider.capabilities] : [],
        credentialKeys:
          catalogProvider?.credentialKeys.map((credential) => ({
            key: credential.key,
            label: credential.label,
            description: credential.description,
            required: credential.required ?? false,
          })) ?? [],
        recommendedForAnalytics:
          catalogProvider?.recommendedTemplateUses.includes(APP_ID) ?? false,
        ...summarizeWorkspaceConnections(
          providerId,
          workspace.connections,
          workspace.grants,
        ),
      };
    });
    const workspaceProviderStatusById = new Map(
      workspaceProviderStatuses.map((provider) => [provider.id, provider]),
    );

    const results = await Promise.all(
      configs.map(async (cfg) => {
        const configured =
          cfg.key === "GITHUB_TOKEN"
            ? !!(await getGitHubAccessToken(ctx)).token
            : (cfg.key === "GONG_ACCESS_KEY" ||
                  cfg.key === "GONG_ACCESS_SECRET") &&
                (await resolveAnalyticsProviderCredential({
                  provider: "gong",
                  keys: [cfg.key],
                  ctx,
                  workspaceConnection: false,
                }))
              ? true
              : await hasCredential(cfg.key, ctx);
        return {
          key: cfg.key,
          label: cfg.label,
          required: cfg.required,
          configured,
        };
      }),
    );
    const configuredKeys = new Set(
      results.filter((result) => result.configured).map((result) => result.key),
    );
    const visibleKeys = new Set(results.map((result) => result.key));
    const providers = credentialProviderConfigs
      .filter((provider) => {
        const requiredMode = provider.requiredMode ?? "all";
        return requiredMode === "any"
          ? provider.requiredKeys.some((key) => visibleKeys.has(key))
          : provider.requiredKeys.every((key) => visibleKeys.has(key));
      })
      .map((provider) => {
        const optionalKeys = provider.optionalKeys ?? [];
        const requiredMode = provider.requiredMode ?? "all";
        const hasRequiredCredentials =
          requiredMode === "any"
            ? provider.requiredKeys.some((key) => configuredKeys.has(key))
            : provider.requiredKeys.every((key) => configuredKeys.has(key));
        const missingRequiredKeys = hasRequiredCredentials
          ? []
          : provider.requiredKeys.filter((key) => !configuredKeys.has(key));
        const configuredProviderKeys = [
          ...provider.requiredKeys,
          ...optionalKeys,
        ].filter((key) => configuredKeys.has(key));
        const workspaceConnection =
          workspaceProviderStatusById.get(provider.provider) ??
          summarizeWorkspaceConnections(
            provider.provider,
            workspace.connections,
            workspace.grants,
          );
        return {
          provider: provider.provider,
          label: provider.label,
          configured:
            hasRequiredCredentials ||
            workspaceConnection.grantState === "connected",
          configuredKeys: configuredProviderKeys,
          missingRequiredKeys,
          optionalKeys,
          workspaceConnection,
        };
      });
    const configuredDataSources = [
      {
        provider: BUILT_IN_FIRST_PARTY_PROVIDER.provider,
        label: BUILT_IN_FIRST_PARTY_PROVIDER.label,
        via: "built-in",
        queryAction: BUILT_IN_FIRST_PARTY_PROVIDER.queryAction,
      },
      ...providers
        .filter((provider) => provider.configured)
        .map((provider) => ({
          provider: provider.provider,
          label: provider.label,
          via:
            provider.configuredKeys.length > 0 &&
            provider.workspaceConnection.grantState === "connected"
              ? "credentials-and-workspace"
              : provider.workspaceConnection.grantState === "connected"
                ? "workspace"
                : "credentials",
        })),
    ];
    const connectedExternalDataSources = configuredDataSources.filter(
      (source) => source.provider !== BUILT_IN_FIRST_PARTY_PROVIDER.provider,
    );
    return {
      // Keep a compact, explicit summary first so models do not infer source
      // availability from the much larger per-credential list below.
      hasConfiguredDataSources: configuredDataSources.length > 0,
      configuredDataSourceCount: configuredDataSources.length,
      configuredDataSources,
      hasConnectedExternalDataSources: connectedExternalDataSources.length > 0,
      connectedExternalDataSourceCount: connectedExternalDataSources.length,
      dataSourcesSetupLink: DATA_SOURCES_SETUP_LINK,
      credentials: results,
      providers: [BUILT_IN_FIRST_PARTY_PROVIDER, ...providers],
      total: results.length,
      workspaceConnections: {
        appId: APP_ID,
        available: !workspace.error,
        error: workspace.error,
        providers: workspaceProviderStatuses,
      },
    };
  },
  link: () => ({
    url: DATA_SOURCES_SETUP_LINK,
    label: "Open Analytics data sources",
    view: "data-sources",
  }),
});
