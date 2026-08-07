import { defineAction } from "@agent-native/core";
import {
  isProviderApiId,
  listProviderApiCatalog,
} from "@agent-native/core/provider-api";
import { getCredentialContext } from "@agent-native/core/server";
import {
  findWorkspaceDispatchAgent,
  getBuiltinAgents,
} from "@agent-native/core/server/agent-discovery";
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

function dispatchBaseHref(): string | undefined {
  const workspaceDispatch = findWorkspaceDispatchAgent();
  if (workspaceDispatch?.url) return workspaceDispatch.url;

  return getBuiltinAgents(APP_ID).find((agent) => agent.id === "dispatch")?.url;
}

function dispatchIntegrationsHref(providerId: string): string | undefined {
  const params = new URLSearchParams({
    provider: providerId,
    appId: APP_ID,
    returnTo: "ask",
  });
  const dispatchHref = dispatchBaseHref();
  if (!dispatchHref) return undefined;
  const base = dispatchHref
    .replace(/\/(?:overview|apps)\/?$/, "")
    .replace(/\/$/, "");
  const path = `integrations?${params.toString()}`;
  try {
    return new URL(path, `${base}/`).toString();
  } catch {
    return `${base}/${path}`;
  }
}

function providerApiConfigured({
  credentialHealth,
  providerApi,
  workspace,
}: {
  credentialHealth: Awaited<ReturnType<typeof credentialHealthForProvider>>;
  providerApi: ReturnType<typeof listProviderApiCatalog>[number] | null;
  workspace: WorkspaceConnectionProviderAppSummary;
}): boolean | null {
  if (!providerApi) return null;
  if (workspace.hasActiveWorkspaceConnection) return true;
  if (providerApi.auth === "none") return true;

  const availableKeys = new Set(
    credentialHealth.details
      .filter((detail) => detail.available)
      .map((detail) => detail.key),
  );

  // Jira's legacy fallback is one complete Basic-auth tuple. The catalog keys
  // are individually optional because OAuth is preferred, so the generic
  // required-key count cannot prove that an unconnected Jira provider is ready.
  if (providerApi.id === "jira") {
    return ["JIRA_BASE_URL", "JIRA_USER_EMAIL", "JIRA_API_TOKEN"].every((key) =>
      availableKeys.has(key),
    );
  }

  if (
    providerApi.auth.startsWith("oauth-bearer:") &&
    !providerApi.auth.includes("-or-")
  ) {
    return false;
  }
  if (providerApi.credentialKeys.length === 0) return false;
  if (
    providerApi.auth.includes("-or-api-key-header:") ||
    providerApi.auth.includes("-or-bearer-key:")
  ) {
    return providerApi.credentialKeys.some((key) => availableKeys.has(key));
  }
  return providerApi.credentialKeys.every((key) => availableKeys.has(key));
}

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
  providerApi,
  providerApiIsConfigured,
  sourceProviderSupported,
  workspace,
}: {
  credentialHealth: Awaited<ReturnType<typeof credentialHealthForProvider>>;
  providerApi: ReturnType<typeof listProviderApiCatalog>[number] | null;
  providerApiIsConfigured: boolean | null;
  sourceProviderSupported: boolean;
  workspace: WorkspaceConnectionProviderAppSummary;
}) {
  if (providerApi && providerApiIsConfigured === false) {
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
        "Connect this provider before Brain makes an on-demand API request.",
    };
  }
  if (!sourceProviderSupported) {
    if (providerApi) {
      return {
        status: "ready" as const,
        message:
          "Authenticated provider API access is ready for on-demand Brain queries.",
      };
    }
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
    "Check reusable Brain source and provider API readiness before using a provider. Each provider reports whether authenticated access is configured and includes an absolute Dispatch setupLink when shared setup is needed. When a requested provider is unavailable, explain the missing connection and return its setupLink instead of attempting provider-api-request; if the user is not a workspace admin, mention that a personal MCP connection may be available in chat.",
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
          ? (listProviderApiCatalog(provider.id)[0] ?? null)
          : null;
        const providerApiIsConfigured = providerApiConfigured({
          credentialHealth,
          providerApi,
          workspace: workspaceConnection,
        });
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
          configured:
            providerApiIsConfigured ??
            (sourceProviderSupported ? credentialHealth.available : null),
          setupLink: dispatchIntegrationsHref(provider.id),
          credentialHealth,
          providerHealth: providerHealthForProvider({
            credentialHealth,
            providerApi,
            providerApiIsConfigured,
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
