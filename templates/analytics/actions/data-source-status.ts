import { defineAction } from "@agent-native/core/action";
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

function dataSourceSetupLink(provider: string): string {
  const source = encodeURIComponent(provider);
  return buildDeepLink({
    app: APP_ID,
    view: "data-sources",
    to: `/data-sources?source=${source}&returnTo=ask`,
  });
}

function requestedProviderIds(
  key: string | undefined,
  credentialKeys: string[],
  workspaceProviders: Array<{ id: string; label: string }>,
): Set<string> | null {
  if (!key) return null;

  const normalize = (value: string) =>
    value.toLowerCase().replace(/[\s_-]+/g, "");
  const normalizedKey = normalize(key);
  const directMatch = credentialProviderConfigs.find(
    (provider) =>
      normalize(provider.provider) === normalizedKey ||
      normalize(provider.label) === normalizedKey,
  );
  if (directMatch) return new Set([directMatch.provider]);
  const workspaceMatch = workspaceProviders.find(
    (provider) =>
      normalize(provider.id) === normalizedKey ||
      normalize(provider.label) === normalizedKey,
  );
  if (workspaceMatch) return new Set([workspaceMatch.id]);

  const selectedKeys = new Set(credentialKeys);
  const associatedProviders = credentialProviderConfigs.filter((provider) =>
    [...provider.requiredKeys, ...(provider.optionalKeys ?? [])].some((key) =>
      selectedKeys.has(key),
    ),
  );
  const completeProviders = associatedProviders.filter((provider) => {
    const matchedRequiredKeys = provider.requiredKeys.filter((providerKey) =>
      selectedKeys.has(providerKey),
    ).length;
    return (provider.requiredMode ?? "all") === "any"
      ? matchedRequiredKeys > 0
      : matchedRequiredKeys === provider.requiredKeys.length;
  });

  if (completeProviders.length === 0) {
    return new Set(associatedProviders.map((provider) => provider.provider));
  }

  // Provider aliases can expand to shared credentials (for example BigQuery
  // also includes a Google Cloud credential). Prefer the most specific
  // provider whose required keys are all part of the requested lookup.
  const mostSpecificKeyCount = Math.max(
    ...completeProviders.map((provider) => provider.requiredKeys.length),
  );
  return new Set(
    completeProviders
      .filter(
        (provider) => provider.requiredKeys.length === mostSpecificKeyCount,
      )
      .map((provider) => provider.provider),
  );
}

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
      connections: await listWorkspaceConnections({
        appId: APP_ID,
        includeDisabled: true,
      }),
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
    "Report available Analytics sources without exposing secrets, including first-party events and granted workspace connections. Use `query-agent-native-analytics` for first-party events. Each provider includes a setup link; key accepts a credential name or provider alias.",
  schema: z.object({
    key: z
      .string()
      .optional()
      .describe(
        "Optional credential key or provider alias to check, e.g. jira, pylon, github, bigquery, or SENTRY_AUTH_TOKEN",
      ),
  }),
  http: { method: "GET" },
  mcpTool: true,
  run: async (args) => {
    const ctx = tryRequestCredentialContext();
    if (!ctx) {
      throw Object.assign(new Error("Sign in to view credential status."), {
        statusCode: 401,
      });
    }

    const workspaceCatalog =
      listWorkspaceConnectionProvidersForTemplate(APP_ID);
    const normalizedKey = args.key?.toLowerCase().replace(/[\s_-]+/g, "");
    const workspaceProviderMatch = workspaceCatalog.some(
      (provider) =>
        provider.id.toLowerCase().replace(/[\s_-]+/g, "") === normalizedKey ||
        provider.label.toLowerCase().replace(/[\s_-]+/g, "") === normalizedKey,
    );
    const { configs, known } = resolveCredentialConfigs(args.key);
    if (args.key && !known && !workspaceProviderMatch) {
      return { error: `Unknown credential key: ${args.key}` };
    }

    const workspace = await listWorkspaceConnectionsForStatus();
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
        const workspaceGrantState = workspaceConnection.grantState;
        const hasWorkspaceGrant =
          workspaceGrantState === "connected" ||
          workspaceGrantState === "granted";
        const configured = hasRequiredCredentials || hasWorkspaceGrant;
        return {
          provider: provider.provider,
          label: provider.label,
          setupLink: dataSourceSetupLink(provider.provider),
          configured: configured ? true : workspace.error ? null : false,
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
                : provider.workspaceConnection.grantState === "granted"
                  ? provider.configuredKeys.length > 0
                    ? "credentials-and-workspace-grant"
                    : "workspace-grant"
                  : "credentials",
        })),
    ];
    const scopedProviderIds = requestedProviderIds(
      args.key,
      configs.map((config) => config.key),
      workspaceProviderStatuses,
    );
    const configuredProviderIds = new Set(
      configuredDataSources.map((source) => source.provider),
    );
    for (const provider of workspaceProviderStatuses) {
      if (
        (provider.grantState !== "connected" &&
          provider.grantState !== "granted") ||
        (scopedProviderIds && !scopedProviderIds.has(provider.id)) ||
        configuredProviderIds.has(provider.id)
      ) {
        continue;
      }
      configuredDataSources.push({
        provider: provider.id,
        label: provider.label,
        via:
          provider.grantState === "connected" ? "workspace" : "workspace-grant",
      });
      configuredProviderIds.add(provider.id);
    }
    const configuredExternalDataSources = configuredDataSources.filter(
      (source) => source.provider !== BUILT_IN_FIRST_PARTY_PROVIDER.provider,
    );
    // A credential being present is configuration, not a verified connection.
    // The workspace summary only reports "connected" when an app-accessible
    // grant has a healthy active connection.
    const connectedExternalDataSources = workspaceProviderStatuses.filter(
      (provider) =>
        provider.grantState === "connected" &&
        (scopedProviderIds === null || scopedProviderIds.has(provider.id)),
    );
    const hasUnknownProviderStatus =
      workspace.error !== null ||
      providers.some((provider) => provider.configured === null);
    return {
      // Keep a compact, explicit summary first so models do not infer source
      // availability from the much larger per-credential list below.
      hasConfiguredDataSources: configuredDataSources.length > 0,
      configuredDataSourceCount: configuredDataSources.length,
      configuredExternalDataSourceCount: configuredExternalDataSources.length,
      configuredDataSources,
      connectedExternalDataSources: connectedExternalDataSources.map(
        ({ id, label }) => ({ provider: id, label, via: "workspace" }),
      ),
      hasConnectedExternalDataSources:
        connectedExternalDataSources.length > 0
          ? true
          : hasUnknownProviderStatus
            ? null
            : false,
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
