import { defineAction } from "@agent-native/core";
import { listWorkspaceConnectionProvidersForTemplate } from "@agent-native/core/connections";
import {
  listWorkspaceConnectionGrants,
  listWorkspaceConnections,
  type SerializedWorkspaceConnectionGrant,
  type SerializedWorkspaceConnection,
} from "@agent-native/core/workspace-connections";
import { accessFilter } from "@agent-native/core/sharing";
import { and, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

const APP_ID = "brain";

const SUPPORTED_SOURCE_PROVIDERS = new Set([
  "generic",
  "clips",
  "slack",
  "granola",
  "github",
]);

function isGrantedToApp(
  connection: SerializedWorkspaceConnection,
  appId: string,
  grants: SerializedWorkspaceConnectionGrant[],
): boolean {
  return (
    connection.allowedApps.length === 0 ||
    connection.allowedApps.includes(appId) ||
    grants.some(
      (grant) => grant.connectionId === connection.id && grant.appId === appId,
    )
  );
}

function serializeConnectionForProvider(
  connection: SerializedWorkspaceConnection,
  grants: SerializedWorkspaceConnectionGrant[],
) {
  const explicitGrant = grants.find(
    (grant) => grant.connectionId === connection.id,
  );
  const grantedToApp = isGrantedToApp(connection, APP_ID, grants);
  return {
    id: connection.id,
    label: connection.label,
    provider: connection.provider,
    accountId: connection.accountId,
    accountLabel: connection.accountLabel,
    status: connection.status,
    grantedToApp,
    grantScope:
      connection.allowedApps.length === 0 ? "all-apps" : "selected-apps",
    allowedApps: connection.allowedApps,
    credentialRefs: connection.credentialRefs.map((ref) => ({
      key: ref.key,
      scope: ref.scope,
      provider: ref.provider,
      label: ref.label,
    })),
    lastCheckedAt: connection.lastCheckedAt,
    lastError: connection.lastError,
    explicitGrant: explicitGrant
      ? {
          id: explicitGrant.id,
          appId: explicitGrant.appId,
          scopes: explicitGrant.scopes,
          credentialRefs: explicitGrant.credentialRefs.map((ref) => ({
            key: ref.key,
            scope: ref.scope,
            provider: ref.provider,
            label: ref.label,
          })),
          updatedAt: explicitGrant.updatedAt,
        }
      : null,
  };
}

function workspaceSummaryForProvider(
  providerId: string,
  connections: SerializedWorkspaceConnection[],
  grants: SerializedWorkspaceConnectionGrant[],
) {
  const allConnections = connections.filter(
    (connection) => connection.provider === providerId,
  );
  const grantedConnections = allConnections.filter((connection) =>
    isGrantedToApp(connection, APP_ID, grants),
  );
  const connectedConnections = grantedConnections.filter(
    (connection) => connection.status === "connected",
  );
  const activeStatuses = new Set(
    allConnections.map((connection) => connection.status),
  );
  const credentialRefCount = allConnections.reduce(
    (count, connection) => count + connection.credentialRefs.length,
    0,
  );
  const grantState = connectedConnections.length
    ? "connected"
    : grantedConnections.length
      ? "granted"
      : allConnections.length
        ? "needs_grant"
        : "not_connected";

  return {
    appId: APP_ID,
    grantState,
    connectionCount: allConnections.length,
    grantedConnectionCount: grantedConnections.length,
    activeConnectionCount: connectedConnections.length,
    credentialRefCount,
    hasWorkspaceConnection: allConnections.length > 0,
    hasGrantedWorkspaceConnection: grantedConnections.length > 0,
    hasActiveWorkspaceConnection: connectedConnections.length > 0,
    statuses: [...activeStatuses],
    connections: allConnections.map((connection) =>
      serializeConnectionForProvider(connection, grants),
    ),
  };
}

async function listWorkspaceConnectionsForCatalog(): Promise<{
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
    "List reusable connection provider metadata relevant to Brain sources, including workspace connection grants for the Brain app.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const [sourceRows, workspace] = await Promise.all([
      getDb()
        .select({ provider: schema.brainSources.provider })
        .from(schema.brainSources)
        .where(
          and(
            accessFilter(schema.brainSources, schema.brainSourceShares),
            ne(schema.brainSources.status, "archived"),
          ),
        ),
      listWorkspaceConnectionsForCatalog(),
    ]);
    const sourceCounts = new Map<string, number>();
    for (const row of sourceRows) {
      sourceCounts.set(row.provider, (sourceCounts.get(row.provider) ?? 0) + 1);
    }

    const providers = listWorkspaceConnectionProvidersForTemplate("brain").map(
      (provider) => {
        const configuredSourceCount = sourceCounts.get(provider.id) ?? 0;
        return {
          id: provider.id,
          label: provider.label,
          description: provider.description,
          capabilities: [...provider.capabilities],
          credentialKeys: provider.credentialKeys.map((credential) => ({
            key: credential.key,
            label: credential.label,
            description: credential.description,
            required: credential.required ?? false,
          })),
          configuredSourceCount,
          hasConfiguredSources: configuredSourceCount > 0,
          sourceProviderSupported: SUPPORTED_SOURCE_PROVIDERS.has(provider.id),
          workspaceConnection: workspaceSummaryForProvider(
            provider.id,
            workspace.connections,
            workspace.grants,
          ),
        };
      },
    );

    return {
      count: providers.length,
      appId: APP_ID,
      workspaceConnections: {
        appId: APP_ID,
        available: !workspace.error,
        error: workspace.error,
      },
      providers,
    };
  },
});
