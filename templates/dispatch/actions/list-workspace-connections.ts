import { defineAction } from "@agent-native/core";
import {
  listWorkspaceConnectionProviders,
  type WorkspaceConnectionCapability,
  type WorkspaceConnectionTemplateUse,
} from "@agent-native/core/connections";
import {
  listWorkspaceConnectionGrants,
  listWorkspaceConnections,
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
  { id: "analytics", label: "Analytics" },
  { id: "mail", label: "Mail" },
] as const;

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
    const legacyGrants = connections.flatMap((connection) => {
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
      return connection.allowedApps.map((appId) => ({
        id: `${connection.id}:${appId}`,
        connectionId: connection.id,
        provider: connection.provider,
        appId,
        access: "selected-app" as const,
      }));
    });
    const grants = [
      ...legacyGrants,
      ...explicitGrants.map((grant) => ({
        id: grant.id,
        connectionId: grant.connectionId,
        provider: grant.provider,
        appId: grant.appId,
        access: "explicit-grant" as const,
      })),
    ];

    return {
      providers,
      connections,
      grants,
      suggestedApps: SUGGESTED_GRANT_APPS,
      counts: {
        providers: providers.length,
        connections: connections.length,
        grants: grants.length,
      },
    };
  },
});
