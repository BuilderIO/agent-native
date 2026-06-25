import { defineAction } from "@agent-native/core";
import {
  isProviderApiId,
  listProviderApiCatalog,
} from "@agent-native/core/provider-api";
import { getCredentialContext } from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import {
  listWorkspaceConnectionProviderCatalogForApp,
  type WorkspaceConnectionProviderCatalogForApp,
  type WorkspaceConnectionProviderCatalogForAppItem,
  type WorkspaceConnectionProviderAppSummary,
} from "@agent-native/core/workspace-connections";
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

async function credentialHealthForProvider(
  provider: WorkspaceConnectionProviderCatalogForAppItem,
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
  workspace: WorkspaceConnectionProviderAppSummary;
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
  catalog: WorkspaceConnectionProviderCatalogForApp | null;
  error: string | null;
}> {
  try {
    return {
      catalog: await listWorkspaceConnectionProviderCatalogForApp({
        appId: APP_ID,
        templateUse: "brain",
        includeDisabled: true,
        includeConnections: "all",
      }),
      error: null,
    };
  } catch (err) {
    return {
      catalog: null,
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
      (workspace.catalog?.providers ?? []).map(async (provider) => {
        const configuredSourceCount = sourceCounts.get(provider.id) ?? 0;
        const sourceProviderSupported = SUPPORTED_SOURCE_PROVIDERS.has(
          provider.id,
        );
        const workspaceConnection = provider.workspaceConnection;
        const credentialHealth = await credentialHealthForProvider(provider);
        const providerApi = isProviderApiId(provider.id)
          ? listProviderApiCatalog(provider.id)[0]
          : null;
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
          workspaceConnection,
        };
      }),
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
