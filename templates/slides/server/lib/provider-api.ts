import {
  createProviderApiRuntime,
  listProviderApiIdsForTemplateUse,
  type ProviderApiDocsOptions,
  type ProviderApiId,
  type ProviderApiMethod,
  type ProviderApiRequestArgs,
} from "@agent-native/core/provider-api";
import { getCredentialContext } from "@agent-native/core/server";

import { GOOGLE_DOCS_PROVIDER } from "./google-docs-oauth.js";

export const SLIDES_APP_ID = "slides";
export const SLIDES_PROVIDER_API_IDS = listProviderApiIdsForTemplateUse(
  "slides",
) as [ProviderApiId, ...ProviderApiId[]];
export type SlidesProviderApiId = (typeof SLIDES_PROVIDER_API_IDS)[number];
export type { ProviderApiMethod, ProviderApiRequestArgs };

const runtimeOptions = {
  appId: SLIDES_APP_ID,
  providerIds: SLIDES_PROVIDER_API_IDS,
  localCredentialSource: `${SLIDES_APP_ID}_local`,
  getCredentialContext: () => {
    const ctx = getCredentialContext();
    if (!ctx) {
      throw new Error(
        "Slides provider API requests require an authenticated request context.",
      );
    }
    return ctx;
  },
  oauthProviderOverrides: {
    google_drive: GOOGLE_DOCS_PROVIDER,
  },
};

const runtime = createProviderApiRuntime(runtimeOptions);

export function getSlidesProviderApiRuntime() {
  return runtime;
}

export function listProviderApiCatalog(provider?: SlidesProviderApiId) {
  return runtime.listCatalog(provider);
}

export function fetchProviderApiDocs(
  options: ProviderApiDocsOptions & { provider: SlidesProviderApiId },
) {
  return runtime.fetchDocs(options);
}

export function executeProviderApiRequest(args: ProviderApiRequestArgs) {
  return runtime.executeRequest(args);
}
