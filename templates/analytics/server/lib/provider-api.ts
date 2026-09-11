import {
  createProviderApiRuntime,
  listCustomProviders,
  listProviderApiIdsForTemplateUse,
  type ProviderApiCredentialResolver,
  type ProviderApiDocsOptions,
  type ProviderApiId,
  type ProviderApiMethod,
  type ProviderApiRequestArgs,
} from "@agent-native/core/provider-api";

import {
  requireRequestCredentialContext,
  tryRequestCredentialContext,
} from "./credentials-context";
import { resolveAnalyticsProviderCredential } from "./provider-credentials";

export const ANALYTICS_PROVIDER_API_IDS = Array.from(
  new Set([
    ...listProviderApiIdsForTemplateUse("analytics"),
    // Google Sheets creation and writes use the existing Google Drive OAuth
    // connection, whose consent is limited to drive.file.
    "google_drive" as ProviderApiId,
  ]),
) as [ProviderApiId, ...ProviderApiId[]];
export type AnalyticsProviderApiId = ProviderApiId;
export type { ProviderApiMethod, ProviderApiRequestArgs };

const resolveAnalyticsCredential: ProviderApiCredentialResolver = async ({
  provider,
  key,
  ctx,
  workspaceProvider,
  connectionId,
}) => {
  const credential = await resolveAnalyticsProviderCredential({
    provider: workspaceProvider ?? provider,
    keys: [key],
    ctx,
    workspaceConnection: Boolean(workspaceProvider),
    connectionId,
  });
  if (!credential) return null;
  return {
    key: credential.key,
    value: credential.value,
    source: credential.source,
    provider: credential.provider,
    connectionId: credential.connectionId,
    connectionLabel: credential.connectionLabel,
    scope: credential.scope,
  };
};

const runtime = createProviderApiRuntime({
  appId: "analytics",
  providerIds: ANALYTICS_PROVIDER_API_IDS,
  localCredentialSource: "analytics_local",
  getCredentialContext: () =>
    requireRequestCredentialContext("provider API credential"),
  resolveCredential: resolveAnalyticsCredential,
  getCustomProviders: async () => {
    const ctx = tryRequestCredentialContext();
    if (!ctx) return [];

    const orgProviders = ctx.orgId
      ? await listCustomProviders("org", ctx.orgId)
      : [];
    const userProviders = await listCustomProviders("user", ctx.userEmail);
    const seen = new Set<string>();
    return [...orgProviders, ...userProviders].filter((provider) => {
      if (seen.has(provider.id)) return false;
      seen.add(provider.id);
      return true;
    });
  },
});

export function getAnalyticsProviderApiRuntime() {
  return runtime;
}

export function listProviderApiCatalog(provider?: AnalyticsProviderApiId) {
  return runtime.listCatalog(provider);
}

export function fetchProviderApiDocs(
  options: ProviderApiDocsOptions & { provider: AnalyticsProviderApiId },
) {
  return runtime.fetchDocs(options);
}

export function executeProviderApiRequest(args: ProviderApiRequestArgs) {
  return runtime.executeRequest(args);
}
