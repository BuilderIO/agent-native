import {
  createProviderApiRuntime,
  defaultProviderApiCredentialResolver,
  listProviderApiIdsForTemplateUse,
  type ProviderApiCredentialLookupOptions,
  type ProviderApiCredentialResolver,
  type ProviderApiDocsOptions,
  type ProviderApiId,
  type ProviderApiMethod,
  type ProviderApiRequestArgs,
  type ProviderApiResolvedCredential,
} from "@agent-native/core/provider-api";
import { getCredentialContext } from "@agent-native/core/server";

import { getHubSpotApiKey } from "./hubspot.js";

export const MAIL_APP_ID = "mail";
export const MAIL_PROVIDER_API_IDS = listProviderApiIdsForTemplateUse(
  "mail",
) as [ProviderApiId, ...ProviderApiId[]];
export type MailProviderApiId = ProviderApiId;
export type { ProviderApiMethod, ProviderApiRequestArgs };

function legacyCredential(
  options: ProviderApiCredentialLookupOptions,
  key: string,
  value: string,
): ProviderApiResolvedCredential {
  return {
    key,
    value,
    source: `${MAIL_APP_ID}_legacy_credentials`,
    provider: options.provider,
  };
}

async function resolveLegacyHubSpotCredential(
  options: ProviderApiCredentialLookupOptions,
): Promise<ProviderApiResolvedCredential | null> {
  if (
    options.provider !== "hubspot" ||
    (options.key !== "HUBSPOT_PRIVATE_APP_TOKEN" &&
      options.key !== "HUBSPOT_ACCESS_TOKEN")
  ) {
    return null;
  }

  const value = await getHubSpotApiKey(options.ctx.userEmail);
  return value ? legacyCredential(options, "HUBSPOT_API_KEY", value) : null;
}

const resolveMailCredential: ProviderApiCredentialResolver = async (
  options,
) => {
  const direct = await defaultProviderApiCredentialResolver(options);
  if (direct) return direct;
  return resolveLegacyHubSpotCredential(options);
};

const runtime = createProviderApiRuntime({
  appId: MAIL_APP_ID,
  providerIds: MAIL_PROVIDER_API_IDS,
  localCredentialSource: `${MAIL_APP_ID}_local`,
  getCredentialContext: () => {
    const ctx = getCredentialContext();
    if (!ctx) {
      throw new Error(
        "Mail provider API requests require an authenticated request context.",
      );
    }
    return ctx;
  },
  resolveCredential: resolveMailCredential,
});

export function getMailProviderApiRuntime() {
  return runtime;
}

export function listProviderApiCatalog(provider?: MailProviderApiId) {
  return runtime.listCatalog(provider);
}

export function fetchProviderApiDocs(
  options: ProviderApiDocsOptions & { provider: MailProviderApiId },
) {
  return runtime.fetchDocs(options);
}

export function executeProviderApiRequest(args: ProviderApiRequestArgs) {
  return runtime.executeRequest(args);
}
