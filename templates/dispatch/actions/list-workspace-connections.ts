import { defineAction } from "@agent-native/core";
import {
  isProviderApiId,
  listProviderApiCatalog,
} from "@agent-native/core/provider-api";
import {
  listWorkspaceConnectionProviders,
  type WorkspaceConnectionCapability,
  type WorkspaceConnectionTemplateUse,
} from "@agent-native/core/connections";
import {
  getWorkspaceConnectionAppAccess,
  listWorkspaceConnectionGrants,
  listWorkspaceConnections,
  summarizeWorkspaceConnectionProviderReadiness,
} from "@agent-native/core/workspace-connections";
import { z } from "zod";

const httpBoolean = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

const SUGGESTED_GRANT_APPS = [
  { id: "dispatch", label: "Dispatch" },
  { id: "brain", label: "Brain" },
  { id: "assets", label: "Assets" },
  { id: "analytics", label: "Analytics" },
  { id: "mail", label: "Mail" },
] as const;

type GrantSummary = {
  id: string;
  connectionId: string;
  provider: string;
  appId: string;
  access: "all-apps" | "selected-app" | "explicit-grant";
  lastUsedAt?: string | null;
};

function unique(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function optionalTimestamp(source: object, key: string) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  const value = (source as Record<string, unknown>)[key];
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export default defineAction({
  description:
    "List the workspace integration provider catalog, saved shared connections, and app access grants.",
  schema: z.object({
    provider: z
      .string()
      .optional()
      .describe("Optional provider ID such as slack, github, or notion."),
    appId: z
      .string()
      .optional()
      .describe("Only include connections available to this app ID."),
    includeDisabled: httpBoolean
      .default(false)
      .describe("Include disabled connections. Defaults to false."),
    capability: z
      .string()
      .optional()
      .describe("Optional capability filter such as search, import, or docs."),
    templateUse: z
      .string()
      .optional()
      .describe("Optional template-use filter such as brain or analytics."),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const providers = listWorkspaceConnectionProviders({
      capability: args.capability as WorkspaceConnectionCapability | undefined,
      templateUse: args.templateUse as
        | WorkspaceConnectionTemplateUse
        | undefined,
    });
    const connections = await listWorkspaceConnections({
      provider: args.provider,
      appId: args.appId,
      includeDisabled: args.includeDisabled,
    });
    const explicitGrants = await listWorkspaceConnectionGrants({
      provider: args.provider,
      appId: args.appId,
    });
    const legacyGrants = connections.flatMap<GrantSummary>((connection) => {
      if (connection.allowedApps.length === 0) {
        return [
          {
            id: `${connection.id}:all-apps`,
            connectionId: connection.id,
            provider: connection.provider,
            appId: "*",
            access: "all-apps" as const,
          },
        ];
      }
      return connection.allowedApps.map(
        (appId): GrantSummary => ({
          id: `${connection.id}:${appId}`,
          connectionId: connection.id,
          provider: connection.provider,
          appId,
          access: "selected-app" as const,
        }),
      );
    });
    const grants: GrantSummary[] = [
      ...legacyGrants,
      ...explicitGrants.map((grant) => {
        const lastUsedAt = optionalTimestamp(grant, "lastUsedAt");
        return {
          id: grant.id,
          connectionId: grant.connectionId,
          provider: grant.provider,
          appId: grant.appId,
          access: "explicit-grant" as const,
          ...(lastUsedAt !== undefined ? { lastUsedAt } : {}),
        };
      }),
    ];
    const grantSummaries = connections.map((connection) => {
      const explicitGrantAppIds = unique(
        explicitGrants
          .filter((grant) => grant.connectionId === connection.id)
          .map((grant) => grant.appId),
      );
      const selectedAppIds = unique(connection.allowedApps);
      const allApps = selectedAppIds.length === 0;
      const effectiveAppIds = allApps
        ? ["*"]
        : unique([...selectedAppIds, ...explicitGrantAppIds]);

      return {
        connectionId: connection.id,
        provider: connection.provider,
        accessMode: allApps
          ? ("all-apps" as const)
          : ("selected-apps" as const),
        allApps,
        selectedAppIds,
        explicitGrantAppIds,
        effectiveAppIds,
        trackedApps: SUGGESTED_GRANT_APPS.map((app) => {
          const access = getWorkspaceConnectionAppAccess(
            connection,
            app.id,
            explicitGrants,
          );
          return {
            appId: app.id,
            label: app.label,
            granted: access.available,
            mode: access.mode,
            grantId: access.grantId,
          };
        }),
      };
    });

    const providersWithReadiness = providers.map((provider) => {
      const providerApi = isProviderApiId(provider.id)
        ? listProviderApiCatalog(provider.id)[0]
        : null;
      return {
        ...provider,
        readiness: summarizeWorkspaceConnectionProviderReadiness({
          provider,
          connections,
          grants: explicitGrants,
          appId: args.appId,
          includeConnections: "all",
        }),
        rawProviderApi: providerApi
          ? {
              available: true,
              actionNames: [
                "provider-api-catalog",
                "provider-api-docs",
                "provider-api-request",
              ],
              docsUrls: providerApi.docsUrls,
              specUrls: providerApi.specUrls,
              auth: providerApi.auth,
              examples: providerApi.examples,
            }
          : {
              available: false,
              actionNames: [],
              docsUrls: [],
              specUrls: [],
              auth: null,
              examples: [],
            },
      };
    });

    return {
      providers: providersWithReadiness,
      connections,
      grants,
      grantSummaries,
      suggestedApps: SUGGESTED_GRANT_APPS,
      counts: {
        providers: providersWithReadiness.length,
        connections: connections.length,
        grants: grants.length,
        allAppConnections: grantSummaries.filter((summary) => summary.allApps)
          .length,
        selectedAppConnections: grantSummaries.filter(
          (summary) => !summary.allApps,
        ).length,
        readyProviders: providersWithReadiness.filter(
          (provider) => provider.readiness.status === "ready",
        ).length,
      },
    };
  },
});
