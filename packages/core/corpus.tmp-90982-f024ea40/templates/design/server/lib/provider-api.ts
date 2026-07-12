import {
  createProviderApiRuntime,
  listProviderApiIdsForTemplateUse,
  type ProviderApiCredentialResolver,
  type ProviderApiDocsOptions,
  type ProviderApiId,
  type ProviderApiMethod,
  type ProviderApiRequestArgs,
} from "@agent-native/core/provider-api";
import { getCredentialContext, resolveSecret } from "@agent-native/core/server";

export const DESIGN_APP_ID = "design";
export const DESIGN_PROVIDER_API_IDS = listProviderApiIdsForTemplateUse(
  "design",
) as [ProviderApiId, ...ProviderApiId[]];
export type DesignProviderApiId = (typeof DESIGN_PROVIDER_API_IDS)[number];
export type { ProviderApiMethod, ProviderApiRequestArgs };

const resolveDesignCredential: ProviderApiCredentialResolver = async (
  options,
) => {
  const supported =
    (options.provider === "github" && options.key === "GITHUB_TOKEN") ||
    (options.provider === "figma" && options.key === "FIGMA_ACCESS_TOKEN");
  if (!supported) {
    return null;
  }

  const value = await resolveSecret(options.key);
  if (!value) return null;

  return {
    key: options.key,
    value,
    source: `${DESIGN_APP_ID}_secret`,
    provider: options.provider,
    scope: "request",
  };
};

const runtime = createProviderApiRuntime({
  appId: DESIGN_APP_ID,
  providerIds: DESIGN_PROVIDER_API_IDS,
  localCredentialSource: `${DESIGN_APP_ID}_local`,
  getCredentialContext: () => {
    const ctx = getCredentialContext();
    if (!ctx) {
      throw new Error(
        "Design provider API requests require an authenticated request context.",
      );
    }
    return ctx;
  },
  resolveCredential: resolveDesignCredential,
});

export function getDesignProviderApiRuntime() {
  return runtime;
}

export function listProviderApiCatalog(provider?: DesignProviderApiId) {
  return runtime.listCatalog(provider);
}

export function fetchProviderApiDocs(
  options: ProviderApiDocsOptions & { provider: DesignProviderApiId },
) {
  return runtime.fetchDocs(options);
}

export function executeProviderApiRequest(args: ProviderApiRequestArgs) {
  return runtime.executeRequest(args);
}
