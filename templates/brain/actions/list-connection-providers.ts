import { defineAction } from "@agent-native/core";
import { listWorkspaceConnectionProvidersForTemplate } from "@agent-native/core/connections";
import { getCredentialContext } from "@agent-native/core/server";
import {
  getWorkspaceConnectionAppAccess,
  listWorkspaceConnectionGrants,
  listWorkspaceConnections,
  type SerializedWorkspaceConnectionGrant,
  type SerializedWorkspaceConnection,
} from "@agent-native/core/workspace-connections";
import { accessFilter } from "@agent-native/core/sharing";
import { and, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  inspectSourceCredentialAvailability,
  type SourceCredentialAvailability,
} from "../server/lib/source-credentials.js";

const APP_ID = "brain";

const SUPPORTED_SOURCE_PROVIDERS = new Set([
  "generic",
  "clips",
  "slack",
  "granola",
  "github",
]);

function serializeCredentialRef(
  ref: { key: string; scope?: string; provider?: string; label?: string },
  source: "connection" | "grant",
) {
  return {
    key: ref.key,
    scope: ref.scope,
    provider: ref.provider,
    label: ref.label,
    source,
  };
}

function serializeConnectionForProvider(
  connection: SerializedWorkspaceConnection,
  grants: SerializedWorkspaceConnectionGrant[],
) {
  const explicitGrant = grants.find(
    (grant) => grant.connectionId === connection.id,
  );
  const appAccess = getWorkspaceConnectionAppAccess(connection, APP_ID, grants);
  return {
    id: connection.id,
    label: connection.label,
    provider: connection.provider,
    accountId: connection.accountId,
    accountLabel: connection.accountLabel,
    status: connection.status,
    grantedToApp: appAccess.available,
    grantScope:
      connection.allowedApps.length === 0 ? "all-apps" : "selected-apps",
    appAccess,
    allowedApps: connection.allowedApps,
    credentialRefs: connection.credentialRefs.map((ref) =>
      serializeCredentialRef(ref, "connection"),
    ),
    lastCheckedAt: connection.lastCheckedAt,
    lastError: connection.lastError,
    explicitGrant: explicitGrant
      ? {
          id: explicitGrant.id,
          appId: explicitGrant.appId,
          scopes: explicitGrant.scopes,
          credentialRefs: explicitGrant.credentialRefs.map((ref) =>
            serializeCredentialRef(ref, "grant"),
          ),
          updatedAt: explicitGrant.updatedAt,
        }
      : null,
  };
}

function grantAvailabilityMessage(
  grantState: "connected" | "granted" | "needs_grant" | "not_connected",
  providerId: string,
) {
  switch (grantState) {
    case "connected":
      return `Brain has an active ${providerId} workspace connection.`;
    case "granted":
      return `Brain has ${providerId} access, but the granted connection is not connected yet.`;
    case "needs_grant":
      return `A ${providerId} workspace connection exists; grant Brain access to reuse it.`;
    case "not_connected":
    default:
      return `No shared ${providerId} workspace connection is available yet.`;
  }
}

function workspaceSummaryForProvider(
  providerId: string,
  connections: SerializedWorkspaceConnection[],
  grants: SerializedWorkspaceConnectionGrant[],
) {
  const allConnections = connections.filter(
    (connection) => connection.provider === providerId,
  );
  const grantedConnections = allConnections.filter(
    (connection) =>
      getWorkspaceConnectionAppAccess(connection, APP_ID, grants).available,
  );
  const connectedConnections = grantedConnections.filter(
    (connection) => connection.status === "connected",
  );
  const ungrantedConnectionCount =
    allConnections.length - grantedConnections.length;
  const unhealthyGrantedConnectionCount =
    grantedConnections.length - connectedConnections.length;
  const activeStatuses = new Set(
    allConnections.map((connection) => connection.status),
  );
  const credentialRefCount = allConnections.reduce((count, connection) => {
    const grant = grants.find((entry) => entry.connectionId === connection.id);
    return (
      count +
      connection.credentialRefs.length +
      (grant?.credentialRefs.length ?? 0)
    );
  }, 0);
  const grantState = connectedConnections.length
    ? ("connected" as const)
    : grantedConnections.length
      ? ("granted" as const)
      : allConnections.length
        ? ("needs_grant" as const)
        : ("not_connected" as const);
  const explicitGrantCount = allConnections.reduce(
    (count, connection) =>
      grants.some((grant) => grant.connectionId === connection.id)
        ? count + 1
        : count,
    0,
  );

  return {
    appId: APP_ID,
    grantState,
    grantAvailability:
      grantState === "connected" || grantState === "granted"
        ? "available"
        : grantState,
    grantAvailabilityMessage: grantAvailabilityMessage(grantState, providerId),
    connectionCount: allConnections.length,
    grantedConnectionCount: grantedConnections.length,
    activeConnectionCount: connectedConnections.length,
    ungrantedConnectionCount,
    unhealthyGrantedConnectionCount,
    explicitGrantCount,
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

async function credentialHealthForProvider(
  provider: ReturnType<
    typeof listWorkspaceConnectionProvidersForTemplate
  >[number],
): Promise<{
  status: "available" | "missing" | "not_required" | "unavailable";
  available: boolean;
  requiredKeyCount: number;
  availableKeyCount: number;
  missingCredentialKeys: string[];
  missingMessages: string[];
  details: SourceCredentialAvailability[];
}> {
  const credentialKeys = provider.credentialKeys;
  const requiredKeys = credentialKeys.filter(
    (credential) => credential.required ?? false,
  );
  if (credentialKeys.length === 0) {
    return {
      status: "not_required",
      available: true,
      requiredKeyCount: 0,
      availableKeyCount: 0,
      missingCredentialKeys: [],
      missingMessages: [],
      details: [],
    };
  }

  const ctx = getCredentialContext();
  if (!ctx) {
    return {
      status: "unavailable",
      available: false,
      requiredKeyCount: requiredKeys.length,
      availableKeyCount: 0,
      missingCredentialKeys: requiredKeys.map((credential) => credential.key),
      missingMessages: ["Sign in before checking credential availability."],
      details: [],
    };
  }

  const details = await Promise.all(
    credentialKeys.map((credential) =>
      inspectSourceCredentialAvailability({
        provider: provider.id,
        key: credential.key,
        ctx,
      }),
    ),
  );
  const requiredDetails = details.filter((detail) =>
    requiredKeys.some((credential) => credential.key === detail.key),
  );
  const missingRequired = requiredDetails.filter((detail) => !detail.available);

  return {
    status: missingRequired.length ? "missing" : "available",
    available: missingRequired.length === 0,
    requiredKeyCount: requiredKeys.length,
    availableKeyCount: requiredDetails.filter((detail) => detail.available)
      .length,
    missingCredentialKeys: missingRequired.map((detail) => detail.key),
    missingMessages: missingRequired
      .map((detail) => detail.missingMessage)
      .filter((message): message is string => !!message),
    details,
  };
}

function providerHealthForProvider({
  credentialHealth,
  sourceProviderSupported,
  workspace,
}: {
  credentialHealth: Awaited<ReturnType<typeof credentialHealthForProvider>>;
  sourceProviderSupported: boolean;
  workspace: ReturnType<typeof workspaceSummaryForProvider>;
}) {
  if (!sourceProviderSupported) {
    return {
      status: "unsupported" as const,
      message:
        "Shared connection metadata is available, but Brain source setup is not implemented for this provider yet.",
    };
  }
  if (credentialHealth.status === "not_required") {
    return {
      status: "ready" as const,
      message: "No credential key is required for this provider.",
    };
  }
  if (credentialHealth.available) {
    return {
      status: "ready" as const,
      message:
        "Required credential keys are available without exposing values.",
    };
  }
  if (workspace.grantState === "needs_grant") {
    return {
      status: "needs_grant" as const,
      message: workspace.grantAvailabilityMessage,
    };
  }
  if (
    workspace.hasGrantedWorkspaceConnection &&
    !workspace.hasActiveWorkspaceConnection
  ) {
    return {
      status: "unhealthy" as const,
      message:
        "Brain has a grant, but the shared connection needs reauth or repair.",
    };
  }
  return {
    status: "missing_credentials" as const,
    message:
      credentialHealth.missingMessages[0] ??
      "Required credential keys are not available yet.",
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

    const providers = await Promise.all(
      listWorkspaceConnectionProvidersForTemplate("brain").map(
        async (provider) => {
          const configuredSourceCount = sourceCounts.get(provider.id) ?? 0;
          const sourceProviderSupported = SUPPORTED_SOURCE_PROVIDERS.has(
            provider.id,
          );
          const workspaceConnection = workspaceSummaryForProvider(
            provider.id,
            workspace.connections,
            workspace.grants,
          );
          const credentialHealth = await credentialHealthForProvider(provider);
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
            sourceProviderSupported,
            credentialHealth,
            providerHealth: providerHealthForProvider({
              credentialHealth,
              sourceProviderSupported,
              workspace: workspaceConnection,
            }),
            workspaceConnection,
          };
        },
      ),
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
