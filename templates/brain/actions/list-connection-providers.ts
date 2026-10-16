import { defineAction } from "@agent-native/core/action";
import {
  isProviderApiId,
  isValidProviderApiBaseUrl,
  listProviderApiCatalog,
} from "@agent-native/core/provider-api";
import { getCredentialContext } from "@agent-native/core/server";
import {
  findWorkspaceDispatchAgent,
  getBuiltinAgents,
} from "@agent-native/core/server/agent-discovery";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
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
  hasCredentialLookupError,
  inspectSourceCredentialAvailability,
  resolveSourceCredentialWithProvenance,
  type SourceCredentialAvailability,
} from "../server/lib/source-credentials.js";
import { isBrainAdmin } from "../server/lib/zoom-governance.js";

const APP_ID = "brain";
const BRAIN_API_KEYS_HREF = "/settings/api-keys";

const SUPPORTED_SOURCE_PROVIDERS = new Set([
  "generic",
  "clips",
  "slack",
  "granola",
  "github",
  "zoom",
]);

type CatalogProvider = Omit<
  WorkspaceConnectionProviderCatalogForAppItem,
  "id" | "readiness"
> & {
  id: string;
};

// These providers use Brain's own organization-scoped API keys instead of a
// shared workspace connection grant.
const BRAIN_LOCAL_PROVIDERS: readonly Omit<
  CatalogProvider,
  "workspaceConnection"
>[] = [
  {
    id: "zoom",
    label: "Zoom",
    description:
      "Cloud-recording meeting transcripts through a Zoom Server-to-Server OAuth app.",
    credentialKeys: [
      { key: "ZOOM_ACCOUNT_ID", label: "Zoom Account ID", required: true },
      { key: "ZOOM_CLIENT_ID", label: "Zoom Client ID", required: true },
      {
        key: "ZOOM_CLIENT_SECRET",
        label: "Zoom Client Secret",
        required: true,
      },
    ],
    capabilities: ["import", "meetings"],
    recommendedTemplateUses: ["brain"],
  },
  {
    id: "gong",
    label: "Gong",
    description:
      "On-demand Gong call queries using organization API credentials; users do not need individual Gong seats.",
    credentialKeys: [
      { key: "GONG_ACCESS_KEY", label: "Gong Access Key", required: true },
      {
        key: "GONG_ACCESS_SECRET",
        label: "Gong Access Secret",
        required: true,
      },
      {
        key: "GONG_API_BASE",
        label: "Gong API Base URL",
        required: false,
      },
    ],
    capabilities: ["meetings"],
    recommendedTemplateUses: ["brain"],
  },
];

function brainLocalProvider(
  provider: (typeof BRAIN_LOCAL_PROVIDERS)[number],
): CatalogProvider {
  const workspaceConnection: WorkspaceConnectionProviderAppSummary = {
    appId: APP_ID,
    provider: provider.id,
    grantState: "not_connected",
    grantAvailability: "not_connected",
    grantAvailabilityMessage: `${provider.label} has no shared workspace connection; add its keys in Brain Settings > API keys.`,
    connectionCount: 0,
    grantedConnectionCount: 0,
    activeConnectionCount: 0,
    ungrantedConnectionCount: 0,
    unhealthyGrantedConnectionCount: 0,
    explicitGrantCount: 0,
    credentialRefCount: 0,
    hasWorkspaceConnection: false,
    hasGrantedWorkspaceConnection: false,
    hasActiveWorkspaceConnection: false,
    lastUsedAt: null,
    statuses: [],
    connections: [],
  };
  return { ...provider, workspaceConnection };
}

function providersWithBrainLocal(
  catalogProviders: readonly WorkspaceConnectionProviderCatalogForAppItem[],
): CatalogProvider[] {
  const ids = new Set<string>(catalogProviders.map((provider) => provider.id));
  return [
    ...catalogProviders,
    ...BRAIN_LOCAL_PROVIDERS.filter((provider) => !ids.has(provider.id)).map(
      brainLocalProvider,
    ),
  ];
}

async function dispatchBaseHref(): Promise<string | undefined> {
  const workspaceDispatch = await findWorkspaceDispatchAgent();
  if (workspaceDispatch?.url) return workspaceDispatch.url;

  return getBuiltinAgents(APP_ID).find((agent) => agent.id === "dispatch")?.url;
}

function dispatchIntegrationsHref(
  providerId: string,
  dispatchHref: string | undefined,
): string | undefined {
  const params = new URLSearchParams({
    provider: providerId,
    appId: APP_ID,
    returnTo: "ask",
  });
  if (!dispatchHref) return undefined;
  const base = dispatchHref
    .replace(/\/(?:overview|apps)\/?$/, "")
    .replace(/\/$/, "");
  const path = `settings/integrations?${params.toString()}`;
  try {
    return new URL(path, `${base}/`).toString();
  } catch {
    return `${base}/${path}`;
  }
}

function providerApiConfigured({
  credentialHealth,
  providerApi,
  providerApiBaseUrlError,
  workspace,
}: {
  credentialHealth: Awaited<ReturnType<typeof credentialHealthForProvider>>;
  providerApi: ReturnType<typeof listProviderApiCatalog>[number] | null;
  providerApiBaseUrlError: string | null;
  workspace: WorkspaceConnectionProviderAppSummary;
}): boolean | null {
  if (!providerApi) return null;
  if (providerApiBaseUrlError) return false;
  if (credentialHealth.status === "unavailable") return null;
  if (workspace.hasActiveWorkspaceConnection) return true;
  if (providerApi.auth === "none") return true;

  const availableKeys = new Set(
    credentialHealth.details
      .filter((detail) => detail.available)
      .map((detail) => detail.key),
  );

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

async function providerApiBaseUrlErrorForProvider({
  credentialHealth,
  providerApi,
}: {
  credentialHealth: Awaited<ReturnType<typeof credentialHealthForProvider>>;
  providerApi: ReturnType<typeof listProviderApiCatalog>[number] | null;
}): Promise<string | null> {
  if (providerApi?.id !== "gong" || !providerApi.baseUrlCredentialKey) {
    return null;
  }

  const baseUrlKey = providerApi.baseUrlCredentialKey;
  const baseUrlAvailability = credentialHealth.details.find(
    (detail) => detail.key === baseUrlKey,
  );
  if (!baseUrlAvailability?.available) {
    if (baseUrlAvailability && hasCredentialLookupError(baseUrlAvailability)) {
      return "Brain could not verify the organization Gong API base URL from its credential vault.";
    }
    return null;
  }

  const ctx = getCredentialContext();
  if (!ctx) return "Brain could not check the organization Gong API base URL.";

  const credential = await resolveSourceCredentialWithProvenance({
    provider: providerApi.id,
    key: baseUrlKey,
    ctx: { ...ctx, credentialScope: "org" },
  });
  if (!credential?.value) {
    return "Brain could not verify the organization Gong API base URL from its credential vault.";
  }
  if (isValidProviderApiBaseUrl(providerApi.id, credential.value)) return null;

  return "GONG_API_BASE must be an HTTPS /v2 URL on the api.gong.io host or a regional Gong API subdomain.";
}

async function credentialHealthForProvider(provider: CatalogProvider): Promise<{
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
  if (!ctx || (provider.id === "gong" && !ctx.orgId)) {
    return {
      status: "unavailable",
      available: false,
      requiredKeyCount: requiredKeys.length,
      availableKeyCount: 0,
      missingCredentialKeys: [],
      missingMessages: ["Credential availability could not be verified."],
      details: [],
    };
  }

  const inspectedDetails = await Promise.all(
    credentialKeys.map((credential) =>
      inspectSourceCredentialAvailability({
        provider: provider.id,
        key: credential.key,
        ctx: provider.id === "gong" ? { ...ctx, credentialScope: "org" } : ctx,
      }),
    ),
  );
  const requiredDetails = inspectedDetails.filter((detail) =>
    requiredKeys.some((credential) => credential.key === detail.key),
  );
  const unavailableRequired = requiredDetails.filter(
    (detail) => !detail.available && hasCredentialLookupError(detail),
  );
  const missingRequired = requiredDetails.filter(
    (detail) => !detail.available && !hasCredentialLookupError(detail),
  );
  const details = inspectedDetails.map((detail) =>
    hasCredentialLookupError(detail)
      ? {
          ...detail,
          checked: detail.checked.map((check) =>
            check.status === "error"
              ? {
                  ...check,
                  message: "Credential availability could not be verified.",
                }
              : check,
          ),
          missingMessage: detail.available
            ? detail.missingMessage
            : "Credential availability could not be verified.",
        }
      : detail,
  );

  return {
    status: unavailableRequired.length
      ? "unavailable"
      : missingRequired.length
        ? "missing"
        : "available",
    available: unavailableRequired.length === 0 && missingRequired.length === 0,
    requiredKeyCount: requiredKeys.length,
    availableKeyCount: requiredDetails.filter((detail) => detail.available)
      .length,
    missingCredentialKeys: missingRequired.map((detail) => detail.key),
    missingMessages: unavailableRequired.length
      ? ["Credential availability could not be verified."]
      : missingRequired
          .map((detail) => detail.missingMessage)
          .filter((message): message is string => !!message),
    details,
  };
}

function providerHealthForProvider({
  credentialHealth,
  provider,
  providerApi,
  providerApiBaseUrlError,
  providerApiIsConfigured,
  sourceProviderSupported,
  workspace,
}: {
  credentialHealth: Awaited<ReturnType<typeof credentialHealthForProvider>>;
  provider: CatalogProvider;
  providerApi: ReturnType<typeof listProviderApiCatalog>[number] | null;
  providerApiBaseUrlError: string | null;
  providerApiIsConfigured: boolean | null;
  sourceProviderSupported: boolean;
  workspace: WorkspaceConnectionProviderAppSummary;
}) {
  if (providerApiBaseUrlError) {
    return {
      status: "unhealthy" as const,
      message: providerApiBaseUrlError,
    };
  }
  if (providerApi && providerApiIsConfigured === true) {
    return {
      status: "ready" as const,
      message:
        "Authenticated provider API access is ready for on-demand Brain queries.",
    };
  }
  if (
    credentialHealth.status === "unavailable" &&
    workspace.grantState === "needs_grant"
  ) {
    return {
      status: "needs_grant" as const,
      message: workspace.grantAvailabilityMessage,
    };
  }
  if (credentialHealth.status === "unavailable") {
    return {
      status: "unhealthy" as const,
      message: "Brain could not verify the required provider credentials.",
    };
  }
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
      message: BRAIN_LOCAL_PROVIDERS.some(
        (localProvider) => localProvider.id === provider.id,
      )
        ? "Required organization credentials are not available."
        : "Connect this provider before Brain makes an on-demand API request.",
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
    "Check Brain source and on-demand provider API readiness. `configured: true` means Brain can make authenticated requests with an active shared connection or organization-scoped API keys. Use a returned setupLink when present; for Brain-local providers, describe the missing API keys in Brain Settings instead of asking each user to connect a personal provider account.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const [sourceRows, workspace, canManageZoom] = await Promise.all([
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
      isBrainAdmin(getRequestUserEmail(), getRequestOrgId()),
    ]);
    const sourceCounts = new Map<string, number>();
    for (const row of sourceRows) {
      sourceCounts.set(row.provider, (sourceCounts.get(row.provider) ?? 0) + 1);
    }

    const dispatchHref = await dispatchBaseHref();
    const catalogProviders = workspace.catalog?.providers ?? [];
    const catalogProviderIds = new Set<string>(
      catalogProviders.map((provider) => provider.id),
    );
    const visibleProviders = providersWithBrainLocal(catalogProviders).filter(
      (provider) => canManageZoom || provider.id !== "zoom",
    );
    const providers = await Promise.all(
      visibleProviders.map(async (provider) => {
        const configuredSourceCount = sourceCounts.get(provider.id) ?? 0;
        const sourceProviderSupported = SUPPORTED_SOURCE_PROVIDERS.has(
          provider.id,
        );
        const workspaceConnection = provider.workspaceConnection;
        const credentialHealth = await credentialHealthForProvider(provider);
        const providerApi = isProviderApiId(provider.id)
          ? (listProviderApiCatalog(provider.id)[0] ?? null)
          : null;
        const providerApiBaseUrlError =
          await providerApiBaseUrlErrorForProvider({
            credentialHealth,
            providerApi,
          });
        const providerApiIsConfigured = providerApiConfigured({
          credentialHealth,
          providerApi,
          providerApiBaseUrlError,
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
          usesBrainLocalCredentials: BRAIN_LOCAL_PROVIDERS.some(
            (localProvider) => localProvider.id === provider.id,
          ),
          setupLink: (() => {
            const isBrainLocal = BRAIN_LOCAL_PROVIDERS.some(
              (localProvider) => localProvider.id === provider.id,
            );
            const shouldGrantExistingConnection =
              workspaceConnection.grantState === "needs_grant" &&
              workspaceConnection.hasWorkspaceConnection;
            if (
              isBrainLocal &&
              !shouldGrantExistingConnection &&
              (credentialHealth.status !== "available" ||
                providerApiBaseUrlError)
            ) {
              const key =
                providerApiBaseUrlError && providerApi?.baseUrlCredentialKey
                  ? providerApi.baseUrlCredentialKey
                  : (credentialHealth.missingCredentialKeys[0] ??
                    provider.credentialKeys.find((entry) => entry.required)
                      ?.key ??
                    provider.credentialKeys[0]?.key);
              return key
                ? `${BRAIN_API_KEYS_HREF}#secrets:${encodeURIComponent(key)}`
                : BRAIN_API_KEYS_HREF;
            }
            return catalogProviderIds.has(provider.id)
              ? dispatchIntegrationsHref(provider.id, dispatchHref)
              : undefined;
          })(),
          credentialHealth,
          providerHealth: providerHealthForProvider({
            credentialHealth,
            provider,
            providerApi,
            providerApiBaseUrlError,
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
      canManageZoom,
      workspaceConnections: {
        appId: APP_ID,
        available: !workspace.error,
        error: workspace.error,
      },
      providers,
    };
  },
});
