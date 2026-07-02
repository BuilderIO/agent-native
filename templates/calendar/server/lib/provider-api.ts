import { resolveCredential } from "@agent-native/core/credentials";
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

export const CALENDAR_APP_ID = "calendar";
export const CALENDAR_PROVIDER_API_IDS = listProviderApiIdsForTemplateUse(
  "calendar",
) as [ProviderApiId, ...ProviderApiId[]];
export type CalendarProviderApiId = ProviderApiId;
export type { ProviderApiMethod, ProviderApiRequestArgs };

function legacyCredential(
  options: ProviderApiCredentialLookupOptions,
  key: string,
  value: string,
): ProviderApiResolvedCredential {
  return {
    key,
    value,
    source: `${CALENDAR_APP_ID}_legacy_credentials`,
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
  const value = await resolveCredential("HUBSPOT_API_KEY", options.ctx);
  return value ? legacyCredential(options, "HUBSPOT_API_KEY", value) : null;
}

function parseLegacyGongApiKey(value: string): {
  accessKey: string;
  accessSecret: string;
} | null {
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const accessKey = value.slice(0, separator).trim();
  const accessSecret = value.slice(separator + 1).trim();
  return accessKey && accessSecret ? { accessKey, accessSecret } : null;
}

async function resolveLegacyGongCredential(
  options: ProviderApiCredentialLookupOptions,
): Promise<ProviderApiResolvedCredential | null> {
  if (
    options.provider !== "gong" ||
    (options.key !== "GONG_ACCESS_KEY" && options.key !== "GONG_ACCESS_SECRET")
  ) {
    return null;
  }
  const legacyValue = await resolveCredential("GONG_API_KEY", options.ctx);
  if (!legacyValue) return null;
  const parsed = parseLegacyGongApiKey(legacyValue);
  if (!parsed) return null;
  return legacyCredential(
    options,
    "GONG_API_KEY",
    options.key === "GONG_ACCESS_SECRET"
      ? parsed.accessSecret
      : parsed.accessKey,
  );
}

const resolveCalendarCredential: ProviderApiCredentialResolver = async (
  options,
) => {
  const direct = await defaultProviderApiCredentialResolver(options);
  if (direct) return direct;
  return (
    (await resolveLegacyHubSpotCredential(options)) ??
    (await resolveLegacyGongCredential(options))
  );
};

const runtime = createProviderApiRuntime({
  appId: CALENDAR_APP_ID,
  providerIds: CALENDAR_PROVIDER_API_IDS,
  localCredentialSource: `${CALENDAR_APP_ID}_local`,
  getCredentialContext: () => {
    const ctx = getCredentialContext();
    if (!ctx) {
      throw new Error(
        "Calendar provider API requests require an authenticated request context.",
      );
    }
    return ctx;
  },
  resolveCredential: resolveCalendarCredential,
});

export function getCalendarProviderApiRuntime() {
  return runtime;
}

export function listProviderApiCatalog(provider?: CalendarProviderApiId) {
  return runtime.listCatalog(provider);
}

export function fetchProviderApiDocs(
  options: ProviderApiDocsOptions & { provider: CalendarProviderApiId },
) {
  return runtime.fetchDocs(options);
}

export function executeProviderApiRequest(args: ProviderApiRequestArgs) {
  return runtime.executeRequest(args);
}
