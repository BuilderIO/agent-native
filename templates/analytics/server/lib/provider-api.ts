import {
  createProviderApiRuntime,
  listProviderApiIdsForTemplateUse,
  type ProviderApiCredentialResolver,
  type ProviderApiDocsOptions,
  type ProviderApiId,
  type ProviderApiMethod,
  type ProviderApiRequestArgs,
} from "@agent-native/core/provider-api";

import { requireRequestCredentialContext } from "./credentials-context";
import { resolveAnalyticsProviderCredential } from "./provider-credentials";

export const ANALYTICS_PROVIDER_API_IDS = listProviderApiIdsForTemplateUse(
  "analytics",
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
